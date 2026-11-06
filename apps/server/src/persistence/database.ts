import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import initialSchema from "./migrations/0001-initial-schema.ts"

// Migrations run once, in id order, keyed `<id>_<name>`. Never edit one that has shipped; add a new one.
const migrations = SqliteMigrator.fromRecord({
  "0001_initial_schema": initialSchema
})

// The client keeps one connection for its lifetime, so enabling foreign keys once covers every query.
const ForeignKeysOn = Layer.effectDiscard(Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`PRAGMA foreign_keys = ON`
}))

// A library's database at `filename` (node:sqlite, WAL), with foreign keys on and migrations applied. Evals use
// it to record their spend in your library while they run in a scratch one.
export const databaseAt = (filename: string) =>
  SqliteMigrator.layer({ loader: migrations }).pipe(
    Layer.provideMerge(ForeignKeysOn),
    Layer.provideMerge(SqliteClient.layer({ filename }))
  )

// SQLite at ~/.viral/viral.db.
export const DatabaseLive = Layer.unwrap(Effect.gen(function*() {
  const home = yield* ViralHome
  return databaseAt(home.database)
})).pipe(Layer.provide(ViralHome.layer))
