import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// Spend outside a run, as designed in docs/plans/database-schema.md (0009): the chat's intent agent and the generators
// (ElevenLabs voice design, sound effects), so Settings › Usage counts them by short, step, provider and model. A new
// table; nothing rebuilt.
export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`
    CREATE TABLE usage_records (
      id            TEXT PRIMARY KEY,
      project_id    TEXT REFERENCES projects (id) ON DELETE SET NULL,
      step          TEXT NOT NULL,
      provider      TEXT NOT NULL,
      model         TEXT,
      billing       TEXT CHECK (billing IN ('billed', 'subscription')),
      input_tokens  INTEGER,
      output_tokens INTEGER,
      cost_usd      REAL,
      cost_basis    TEXT CHECK (cost_basis IN ('reported', 'estimate', 'unknown')),
      characters    INTEGER,
      created_at    TEXT NOT NULL
    )
  `)
  yield* sql.unsafe("CREATE INDEX usage_records_by_created ON usage_records (created_at)")
})
