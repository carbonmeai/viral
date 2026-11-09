import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import initialSchema from "./migrations/0001-initial-schema.ts"
import multiVideo from "./migrations/0002-multi-video.ts"
import voicePreviews from "./migrations/0003-voice-previews.ts"
import research from "./migrations/0004-research.ts"

// Migrations run once, in id order, keyed `<id>_<name>`. Never edit one that has shipped; add a new one.
const migrations = SqliteMigrator.fromRecord({
  "0001_initial_schema": initialSchema,
  "0002_multi_video": multiVideo,
  "0003_voice_previews": voicePreviews,
  "0004_research": research
})

// Foreign keys are off while migrations run, as SQLite's table rebuild needs (dropping a table would otherwise
// cascade to its children, and the pragma is ignored inside the migrator's transaction); a migration that
// rebuilds tables checks the keys itself before it commits. The client keeps one connection for its lifetime,
// so turning them on afterwards covers every query.
const Migrated = Layer.effectDiscard(Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`PRAGMA foreign_keys = OFF`
  yield* SqliteMigrator.run({ loader: migrations }).pipe(Effect.ensuring(Effect.orDie(sql`PRAGMA foreign_keys = ON`)))
}))

// A library's database at `filename` (node:sqlite, WAL), migrated, with foreign keys on. Evals use it to record
// their spend in your library while they run in a scratch one.
export const databaseAt = (filename: string) => Migrated.pipe(Layer.provideMerge(SqliteClient.layer({ filename })))

// SQLite at ~/.viral/viral.db.
export const DatabaseLive = Layer.unwrap(Effect.gen(function*() {
  const home = yield* ViralHome
  return databaseAt(home.database)
})).pipe(Layer.provide(ViralHome.layer))
