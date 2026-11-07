import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// Shorts from several videos, as designed in docs/plans/database-schema.md (0002): a short's videos move from
// projects.source_id to project_sources (in order, V1 first), video sets get their tables, and runs and
// artifacts can be owned by a set. SQLite can't drop a foreign-key column or change a CHECK in place, so
// projects, runs and artifacts are rebuilt (create new, copy, drop, rename). The migrator turns foreign keys
// off around migrations (SQLite ignores the pragma inside the migration's transaction), so the drops don't
// cascade; this migration counts the rows and checks the foreign keys before it commits, and any failure
// rolls the whole upgrade back.

const SETS = `
  CREATE TABLE source_sets (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    brief       TEXT,                         -- why these videos belong together; the app requires one
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE source_set_members (
    set_id      TEXT NOT NULL REFERENCES source_sets (id) ON DELETE CASCADE,
    source_id   TEXT NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    position    INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),  -- 0-based, in the order you gave them
    PRIMARY KEY (set_id, source_id),
    UNIQUE (set_id, position)
  );
  CREATE INDEX source_set_members_by_source ON source_set_members (source_id)
`

const PROJECTS = `
  CREATE TABLE projects_next (
    id              TEXT PRIMARY KEY,
    number          INTEGER NOT NULL,             -- 1, 2, 3… across the library; gives the "07-" slug prefix
    slug            TEXT NOT NULL,                -- "07-every-taste-candy"
    title           TEXT NOT NULL,
    approach        TEXT NOT NULL,                -- question-recap | claim-interleaved | cut-down (validated in contracts)
    format          TEXT NOT NULL CHECK (format IN ('narrated', 'cut-down')),  -- derived from the approach
    preset_id       TEXT REFERENCES presets (id) ON DELETE SET NULL,     -- null = use the default preset
    music_track_id  TEXT REFERENCES music_tracks (id) ON DELETE SET NULL, -- optional; null = a voice-only short
    voice_id        TEXT,                         -- ElevenLabs voice id; null = the preset's voice
    brief           TEXT,                         -- what the short should achieve, in your words; steers its agents
    set_id          TEXT REFERENCES source_sets (id) ON DELETE SET NULL,  -- the video set it came from, if any
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL                 -- for "last touched" sorting
  );

  CREATE TABLE project_sources (
    project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    source_id   TEXT NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    position    INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),  -- 0-based: V1 = 0; up to 10 videos
    PRIMARY KEY (project_id, source_id),
    UNIQUE (project_id, position)
  );
  CREATE INDEX project_sources_by_source ON project_sources (source_id)
`

const RUNS = `
  CREATE TABLE runs_next (
    id          TEXT PRIMARY KEY,
    -- a source run (source → … → story), a video set's run, or a short's run; exactly one owner
    source_id   TEXT REFERENCES sources (id) ON DELETE CASCADE,
    set_id      TEXT REFERENCES source_sets (id) ON DELETE CASCADE,
    project_id  TEXT REFERENCES projects (id) ON DELETE CASCADE,
    status      TEXT NOT NULL
                  CHECK (status IN ('running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted')),
    from_stage  TEXT,                             -- set when resumed with --from <stage>
    error       TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    CHECK ((source_id IS NOT NULL) + (set_id IS NOT NULL) + (project_id IS NOT NULL) = 1)
  );
  INSERT INTO runs_next (id, source_id, set_id, project_id, status, from_stage, error, started_at, finished_at)
    SELECT id, source_id, NULL, project_id, status, from_stage, error, started_at, finished_at FROM runs;
  DROP TABLE runs;
  ALTER TABLE runs_next RENAME TO runs;
  CREATE INDEX runs_by_source ON runs (source_id, started_at) WHERE source_id IS NOT NULL;
  CREATE INDEX runs_by_set ON runs (set_id, started_at) WHERE set_id IS NOT NULL;
  CREATE INDEX runs_by_project ON runs (project_id, started_at) WHERE project_id IS NOT NULL
`

const ARTIFACTS = `
  CREATE TABLE artifacts_next (
    id           TEXT PRIMARY KEY,
    source_id    TEXT REFERENCES sources (id) ON DELETE CASCADE,   -- video-level artifacts
    set_id       TEXT REFERENCES source_sets (id) ON DELETE CASCADE,  -- a video set's artifacts (set-story)
    project_id   TEXT REFERENCES projects (id) ON DELETE CASCADE,  -- short-level artifacts
    reference_id TEXT REFERENCES reference_videos (id) ON DELETE CASCADE,  -- reference-video analysis
    stage_run_id TEXT REFERENCES stage_runs (id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,
    version      INTEGER NOT NULL,                -- 1, 2, 3… per owner and kind; regenerating adds a version
    data         TEXT,                            -- JSON for structured artifacts, decoded with the kind's schema
    path         TEXT,                            -- file artifacts: relative to the owner's folder
    created_at   TEXT NOT NULL,
    -- exactly one owner
    CHECK ((source_id IS NOT NULL) + (set_id IS NOT NULL) + (project_id IS NOT NULL) + (reference_id IS NOT NULL) = 1),
    CHECK (data IS NOT NULL OR path IS NOT NULL)
  );
  INSERT INTO artifacts_next (id, source_id, set_id, project_id, reference_id, stage_run_id, kind, version, data, path, created_at)
    SELECT id, source_id, NULL, project_id, reference_id, stage_run_id, kind, version, data, path, created_at FROM artifacts;
  DROP TABLE artifacts;
  ALTER TABLE artifacts_next RENAME TO artifacts;
  CREATE UNIQUE INDEX artifacts_source_versions  ON artifacts (source_id, kind, version)  WHERE source_id IS NOT NULL;
  CREATE UNIQUE INDEX artifacts_set_versions     ON artifacts (set_id, kind, version)     WHERE set_id IS NOT NULL;
  CREATE UNIQUE INDEX artifacts_project_versions ON artifacts (project_id, kind, version) WHERE project_id IS NOT NULL;
  CREATE UNIQUE INDEX artifacts_reference_versions ON artifacts (reference_id, kind, version) WHERE reference_id IS NOT NULL
`

// SQLite prepares one statement at a time.
const statements = (script: string) => script.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s !== "")

// Columns some early test libraries never got; a missing one copies as null.
const OPTIONAL_PROJECT_COLUMNS = ["voice_id", "brief"] as const

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const run = (script: string) => Effect.forEach(statements(script), (s) => sql.unsafe(s), { discard: true })
  const count = (table: string) =>
    Effect.map(sql.unsafe<{ readonly n: number }>(`SELECT count(*) AS n FROM ${table}`), (rows) => Number(rows[0]?.n ?? 0))
  const violations = Effect.map(sql.unsafe<Record<string, unknown>>("PRAGMA foreign_key_check"), (rows) => rows.length)

  const before = { projects: yield* count("projects"), runs: yield* count("runs"), artifacts: yield* count("artifacts") }
  const violationsBefore = yield* violations

  yield* run(SETS)

  // projects: the same rows without source_id, which becomes each short's one row in project_sources (V1)
  const columns = new Set(
    (yield* sql.unsafe<{ readonly name: string }>("SELECT name FROM pragma_table_info('projects')")).map((c) => c.name)
  )
  const optional = OPTIONAL_PROJECT_COLUMNS.map((c) => columns.has(c) ? c : `NULL AS ${c}`).join(", ")
  yield* run(PROJECTS)
  yield* sql.unsafe(`
    INSERT INTO projects_next (id, number, slug, title, approach, format, preset_id, music_track_id, voice_id, brief, set_id,
                               created_at, updated_at)
    SELECT id, number, slug, title, approach, format, preset_id, music_track_id, ${optional}, NULL, created_at, updated_at
    FROM projects
  `)
  yield* sql.unsafe("INSERT INTO project_sources (project_id, source_id, position) SELECT id, source_id, 0 FROM projects")
  yield* sql.unsafe("DROP TABLE projects")
  yield* sql.unsafe("ALTER TABLE projects_next RENAME TO projects")

  yield* run(RUNS)
  yield* run(ARTIFACTS)

  const after = {
    projects: yield* count("projects"),
    projectSources: yield* count("project_sources"),
    runs: yield* count("runs"),
    artifacts: yield* count("artifacts")
  }
  const violationsAfter = yield* violations
  const lost = [
    after.projects !== before.projects && `projects ${before.projects} → ${after.projects}`,
    after.projectSources !== before.projects && `project_sources ${after.projectSources} for ${before.projects} projects`,
    after.runs !== before.runs && `runs ${before.runs} → ${after.runs}`,
    after.artifacts !== before.artifacts && `artifacts ${before.artifacts} → ${after.artifacts}`,
    violationsAfter > violationsBefore && `foreign key problems ${violationsBefore} → ${violationsAfter}`
  ].filter((x) => x !== false)
  // dying rolls the migration's transaction back, leaving the library as it was
  if (lost.length > 0) return yield* Effect.die(new Error(`the multi-video upgrade didn't check out: ${lost.join("; ")}`))
})
