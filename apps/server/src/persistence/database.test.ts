import { Effect, Exit } from "effect"
import { SqlClient } from "effect/sql"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { DatabaseLive } from "./database.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-db-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(Effect.provide(effect, DatabaseLive))

test("creates every table from the design in one migration", async () => {
  const [tables, migrations] = await run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return [
      yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      yield* sql<{ readonly name: string }>`SELECT name FROM effect_sql_migrations`
    ] as const
  }))
  assert.deepEqual(
    tables.map((t) => t.name).filter((name) => name !== "effect_sql_migrations"),
    [
      "artifacts", "eval_runs", "music_tracks", "presets", "projects", "reference_videos", "requests", "run_events", "runs",
      "settings", "sound_effects", "sources", "stage_runs"
    ]
  )
  assert.deepEqual(migrations.map((m) => m.name), ["initial_schema"])
})

test("enforces foreign keys and the one-owner rule on artifacts", async () => {
  const results = await run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const now = "2026-11-05T00:00:00.000Z"
    return {
      orphanProject: yield* Effect.exit(sql`
        INSERT INTO projects (id, source_id, number, slug, title, format, created_at, updated_at)
        VALUES ('p1', 'missing', 1, '01-x', 'x', 'narrated', ${now}, ${now})`),
      ownerlessArtifact: yield* Effect.exit(sql`
        INSERT INTO artifacts (id, kind, version, data, created_at) VALUES ('a1', 'script', 1, '{}', ${now})`)
    }
  }))
  assert.ok(Exit.isFailure(results.orphanProject), "project with an unknown source must be rejected")
  assert.ok(Exit.isFailure(results.ownerlessArtifact), "artifact with no owner must be rejected")
})
