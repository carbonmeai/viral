import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// The short's conversation, as designed in docs/plans/database-schema.md (0008): one row per item of a short's chat
// (what you said and what the server did with it, the agents' words, change cards, gates, approvals), deleted with
// the short; and the agent's own words for an attempt on its stage run. A new table and one nullable column.
export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`
    CREATE TABLE chat_items (
      id           TEXT PRIMARY KEY,
      project_id   TEXT REFERENCES projects (id) ON DELETE CASCADE,
      set_id       TEXT REFERENCES source_sets (id) ON DELETE CASCADE,
      seq          INTEGER NOT NULL,
      role         TEXT NOT NULL CHECK (role IN ('you', 'agent', 'app')),
      kind         TEXT NOT NULL,
      stage        TEXT,
      run_id       TEXT REFERENCES runs (id) ON DELETE SET NULL,
      stage_run_id TEXT REFERENCES stage_runs (id) ON DELETE SET NULL,
      request_id   TEXT REFERENCES requests (id) ON DELETE SET NULL,
      body         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      CHECK ((project_id IS NOT NULL) + (set_id IS NOT NULL) = 1)
    )
  `)
  yield* sql.unsafe("CREATE UNIQUE INDEX chat_items_project_seq ON chat_items (project_id, seq) WHERE project_id IS NOT NULL")
  yield* sql.unsafe("CREATE UNIQUE INDEX chat_items_set_seq ON chat_items (set_id, seq) WHERE set_id IS NOT NULL")
  yield* sql.unsafe("ALTER TABLE stage_runs ADD COLUMN reply TEXT")
})
