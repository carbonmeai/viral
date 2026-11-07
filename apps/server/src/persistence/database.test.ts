import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Effect, Exit } from "effect"
import { SqlClient } from "effect/sql"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { databaseAt, DatabaseLive } from "./database.ts"
import initialSchema from "./migrations/0001-initial-schema.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-db-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(Effect.provide(effect, DatabaseLive))

const now = "2026-11-05T00:00:00.000Z"

test("creates every table from the design", async () => {
  const [tables, migrations] = await run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return [
      yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      yield* sql<{ readonly name: string }>`SELECT name FROM effect_sql_migrations ORDER BY migration_id`
    ] as const
  }))
  assert.deepEqual(
    tables.map((t) => t.name).filter((name) => name !== "effect_sql_migrations"),
    [
      "artifacts", "eval_runs", "music_tracks", "presets", "project_sources", "projects", "reference_videos", "requests",
      "run_events", "runs", "settings", "sound_effects", "source_set_members", "source_sets", "sources", "stage_runs"
    ]
  )
  assert.deepEqual(migrations.map((m) => m.name), ["initial_schema", "multi_video"])
})

test("enforces foreign keys and the one-owner rule on artifacts", async () => {
  const results = await run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return {
      orphanVideo: yield* Effect.exit(sql`
        INSERT INTO project_sources (project_id, source_id, position) VALUES ('missing', 'missing', 0)`),
      ownerlessArtifact: yield* Effect.exit(sql`
        INSERT INTO artifacts (id, kind, version, data, created_at) VALUES ('a1', 'script', 1, '{}', ${now})`)
    }
  }))
  assert.ok(Exit.isFailure(results.orphanVideo), "a short's video must exist")
  assert.ok(Exit.isFailure(results.ownerlessArtifact), "artifact with no owner must be rejected")
})

// A library made before multi-video: one source, a short from it with a run, a stage run, a gate and artifacts.
test("upgrades an existing library in place, keeping every row and its links", async () => {
  const file = join(home, "old.db")
  const old = SqliteClient.layer({ filename: file })
  await Effect.runPromise(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`PRAGMA foreign_keys = ON`
    yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord({ "0001_initial_schema": initialSchema }) })
    yield* sql`INSERT INTO sources (id, origin, rights, created_at, updated_at) VALUES ('s1', '{}', 'owned', ${now}, ${now})`
    yield* sql`INSERT INTO sources (id, origin, rights, created_at, updated_at) VALUES ('s2', '{}', 'owned', ${now}, ${now})`
    yield* sql`
      INSERT INTO projects (id, source_id, number, slug, title, approach, format, brief, created_at, updated_at)
      VALUES ('p1', 's1', 1, '01-a', 'A', 'cut-down', 'cut-down', 'keep the jokes', ${now}, ${now}),
             ('p2', 's2', 1, '01-b', 'B', 'question-recap', 'narrated', NULL, ${now}, ${now})`
    yield* sql`INSERT INTO runs (id, project_id, status, started_at) VALUES ('r1', 'p1', 'completed', ${now})`
    yield* sql`INSERT INTO runs (id, source_id, status, started_at) VALUES ('r0', 's1', 'completed', ${now})`
    yield* sql`INSERT INTO stage_runs (id, run_id, stage, status, started_at) VALUES ('sr1', 'r1', 'sections', 'waiting', ${now})`
    yield* sql`
      INSERT INTO requests (id, run_id, stage_run_id, kind, title, status, created_at)
      VALUES ('q1', 'r1', 'sr1', 'approval', 'Approve?', 'pending', ${now})`
    yield* sql`
      INSERT INTO artifacts (id, project_id, stage_run_id, kind, version, data, created_at)
      VALUES ('a1', 'p1', 'sr1', 'cut-plan', 1, '{}', ${now})`
    yield* sql`INSERT INTO artifacts (id, source_id, kind, version, data, created_at) VALUES ('a0', 's1', 'transcript', 1, '{}', ${now})`
  }).pipe(Effect.provide(old)))

  const upgraded = await Effect.runPromise(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const count = (table: string) => Effect.map(sql.unsafe<{ readonly n: number }>(`SELECT count(*) AS n FROM ${table}`), (r) => r[0]!.n)
    const before = {
      projects: (yield* sql`SELECT id, number, slug, brief, set_id FROM projects ORDER BY id`).map((r) => ({ ...r })),
      videos: (yield* sql`SELECT project_id, source_id, position FROM project_sources ORDER BY project_id`).map((r) => ({ ...r })),
      runs: yield* count("runs"),
      artifacts: yield* count("artifacts"),
      requests: yield* count("requests"),
      violations: (yield* sql`PRAGMA foreign_key_check`).length
    }
    // foreign keys are on again: a short's video can't be deleted, and deleting a short cascades as before
    const deleteUsedVideo = yield* Effect.exit(sql`DELETE FROM sources WHERE id = 's1'`)
    yield* sql`DELETE FROM projects WHERE id = 'p1'`
    const cascaded = {
      videos: yield* count("project_sources"),
      runs: yield* count("runs"),
      artifacts: yield* count("artifacts"),
      requests: yield* count("requests")
    }
    return { before, deleteUsedVideo, cascaded }
  }).pipe(Effect.provide(databaseAt(file))))

  assert.deepEqual(upgraded.before.projects, [
    { id: "p1", number: 1, slug: "01-a", brief: "keep the jokes", set_id: null },
    { id: "p2", number: 1, slug: "01-b", brief: null, set_id: null }
  ])
  assert.deepEqual(upgraded.before.videos, [
    { project_id: "p1", source_id: "s1", position: 0 },
    { project_id: "p2", source_id: "s2", position: 0 }
  ])
  assert.deepEqual([upgraded.before.runs, upgraded.before.artifacts, upgraded.before.requests, upgraded.before.violations], [2, 2, 1, 0])
  assert.ok(Exit.isFailure(upgraded.deleteUsedVideo), "a video a short uses can't be deleted")
  assert.deepEqual(upgraded.cascaded, { videos: 1, runs: 1, artifacts: 1, requests: 0 })
})
