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
      "artifacts", "chat_items", "eval_runs", "music_tracks", "presets", "project_sources", "projects", "reference_videos", "requests",
      "run_events", "runs", "settings", "sound_effects", "source_set_members", "source_set_research", "source_sets", "sources", "stage_runs", "usage_records", "voice_previews"
    ]
  )
  assert.deepEqual(migrations.map((m) => m.name), ["initial_schema", "multi_video", "voice_previews", "research", "ranking", "cost_basis", "video_short_names", "chat", "usage_records"])
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

test("a short can be a ranking, and the format stays checked", async () => {
  const results = await run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const insert = (id: string, format: string) =>
      sql`INSERT INTO projects (id, number, slug, title, approach, format, created_at, updated_at)
          VALUES (${id}, 1, '01-x', 'X', 'ranking', ${format}, ${now}, ${now})`
    return { ranking: yield* Effect.exit(insert("rk1", "ranking")), unknown: yield* Effect.exit(insert("rk2", "slideshow")) }
  }))
  assert.ok(Exit.isSuccess(results.ranking), "a ranking short is stored")
  assert.ok(Exit.isFailure(results.unknown), "an unknown format is refused")
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

test("stage and eval runs say where a cost comes from, and nothing else", async () => {
  const [stage, evals] = await run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return [
      yield* sql<{ readonly name: string }>`SELECT name FROM pragma_table_info('stage_runs') WHERE name = 'cost_basis'`,
      yield* sql<{ readonly name: string }>`SELECT name FROM pragma_table_info('eval_runs') WHERE name = 'cost_basis'`
    ] as const
  }))
  assert.equal(stage.length, 1)
  assert.equal(evals.length, 1)
})

test("a video keeps the short name you gave it, and starts with none", async () => {
  const [column, row] = await run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO sources (id, origin, created_at, updated_at) VALUES ('named-video', '{}', ${now}, ${now})`
    const fresh = yield* sql<{ readonly short_name: string | null }>`SELECT short_name FROM sources WHERE id = 'named-video'`
    yield* sql`UPDATE sources SET short_name = 'Heidi' WHERE id = 'named-video'`
    const named = yield* sql<{ readonly short_name: string | null }>`SELECT short_name FROM sources WHERE id = 'named-video'`
    return [
      yield* sql<{ readonly name: string }>`SELECT name FROM pragma_table_info('sources') WHERE name = 'short_name'`,
      [fresh[0]?.short_name ?? null, named[0]?.short_name ?? null]
    ] as const
  }))
  assert.equal(column.length, 1)
  assert.deepEqual(row, [null, "Heidi"])
})

test("a short's chat items are ordered per short, go with the short, and a stage run keeps the agent's words", async () => {
  const [left, duplicate, reply] = await run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO projects (id, number, slug, title, approach, format, created_at, updated_at)
      VALUES ('chat-short', 99, '99-chat', 'Chat', 'cut-down', 'cut-down', ${now}, ${now})`
    yield* sql`INSERT INTO chat_items (id, project_id, seq, role, kind, body, created_at)
      VALUES ('c1', 'chat-short', 1, 'you', 'YouSaid', '{}', ${now})`
    const duplicate = yield* Effect.exit(sql`INSERT INTO chat_items (id, project_id, seq, role, kind, body, created_at)
      VALUES ('c2', 'chat-short', 1, 'agent', 'AgentSaid', '{}', ${now})`)
    yield* sql`INSERT INTO runs (id, project_id, status, started_at) VALUES ('chat-run', 'chat-short', 'completed', ${now})`
    yield* sql`INSERT INTO stage_runs (id, run_id, stage, status, started_at, reply) VALUES ('chat-sr', 'chat-run', 'sections', 'succeeded', ${now}, 'Kept the hook.')`
    const reply = yield* sql<{ readonly reply: string | null }>`SELECT reply FROM stage_runs WHERE id = 'chat-sr'`
    yield* sql`DELETE FROM projects WHERE id = 'chat-short'`
    const left = yield* sql<{ readonly n: number }>`SELECT count(*) AS n FROM chat_items WHERE id = 'c1'`
    return [left[0]?.n, Exit.isFailure(duplicate), reply[0]?.reply] as const
  }))
  assert.equal(duplicate, true, "two items can't share a seq in one short's chat")
  assert.equal(reply, "Kept the hook.")
  assert.equal(left, 0, "deleting the short deletes its chat")
})

test("spend outside a run stays when its short is deleted, with no short", async () => {
  const [row, badBilling] = await run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO projects (id, number, slug, title, approach, format, created_at, updated_at)
      VALUES ('spend-short', 98, '98-spend', 'Spend', 'cut-down', 'cut-down', ${now}, ${now})`
    yield* sql`INSERT INTO usage_records (id, project_id, step, provider, model, billing, input_tokens, output_tokens, cost_usd, created_at)
      VALUES ('u1', 'spend-short', 'chat', 'claude-cli', 'claude-haiku-4-5', 'subscription', 900, 40, 0.012, ${now})`
    const badBilling = yield* Effect.exit(sql`INSERT INTO usage_records (id, step, provider, billing, created_at)
      VALUES ('u2', 'sound-effect', 'elevenlabs', 'free', ${now})`)
    yield* sql`DELETE FROM projects WHERE id = 'spend-short'`
    const row = yield* sql<{ readonly project_id: string | null; readonly cost_usd: number }>`SELECT project_id, cost_usd FROM usage_records WHERE id = 'u1'`
    return [{ ...row[0] }, Exit.isFailure(badBilling)] as const
  }))
  assert.deepEqual(row, { project_id: null, cost_usd: 0.012 })
  assert.equal(badBilling, true, "billing stays checked")
})
