import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// Ranking shorts, as designed in docs/plans/database-schema.md (0005): a third project format, "ranking". SQLite
// can't change a CHECK in place, so projects is rebuilt the way 0002 did it (create new, copy, drop, rename) with
// foreign keys off around the migration; the row count and the foreign keys are checked before it commits, and any
// failure rolls the upgrade back. Nothing else changes: the ranking's moments and plans are artifacts.
const PROJECTS = `
  CREATE TABLE projects_next (
    id              TEXT PRIMARY KEY,
    number          INTEGER NOT NULL,             -- 1, 2, 3… across the library; gives the "07-" slug prefix
    slug            TEXT NOT NULL,                -- "07-every-taste-candy"
    title           TEXT NOT NULL,
    approach        TEXT NOT NULL,                -- question-recap | claim-interleaved | cut-down | ranking (validated in contracts)
    format          TEXT NOT NULL CHECK (format IN ('narrated', 'cut-down', 'ranking')),  -- derived from the approach
    preset_id       TEXT REFERENCES presets (id) ON DELETE SET NULL,     -- null = use the default preset
    music_track_id  TEXT REFERENCES music_tracks (id) ON DELETE SET NULL, -- optional; null = a voice-only short
    voice_id        TEXT,                         -- ElevenLabs voice id; null = the preset's voice
    brief           TEXT,                         -- what the short should achieve, in your words; steers its agents
    set_id          TEXT REFERENCES source_sets (id) ON DELETE SET NULL,  -- the video set it came from, if any
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL                 -- for "last touched" sorting
  )
`

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const count = (table: string) =>
    Effect.map(sql.unsafe<{ readonly n: number }>(`SELECT count(*) AS n FROM ${table}`), (rows) => Number(rows[0]?.n ?? 0))
  const violations = Effect.map(sql.unsafe<Record<string, unknown>>("PRAGMA foreign_key_check"), (rows) => rows.length)

  const before = yield* count("projects")
  const violationsBefore = yield* violations
  yield* sql.unsafe(PROJECTS)
  yield* sql.unsafe(`
    INSERT INTO projects_next (id, number, slug, title, approach, format, preset_id, music_track_id, voice_id, brief, set_id,
                               created_at, updated_at)
    SELECT id, number, slug, title, approach, format, preset_id, music_track_id, voice_id, brief, set_id, created_at, updated_at
    FROM projects
  `)
  yield* sql.unsafe("DROP TABLE projects")
  yield* sql.unsafe("ALTER TABLE projects_next RENAME TO projects")

  const after = yield* count("projects")
  const violationsAfter = yield* violations
  const lost = [
    after !== before && `projects ${before} → ${after}`,
    violationsAfter > violationsBefore && `foreign key problems ${violationsBefore} → ${violationsAfter}`
  ].filter((x) => x !== false)
  // dying rolls the migration's transaction back, leaving the library as it was
  if (lost.length > 0) return yield* Effect.die(new Error(`the ranking upgrade didn't check out: ${lost.join("; ")}`))
})
