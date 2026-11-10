import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// Where a recorded cost comes from, as designed in docs/plans/database-schema.md (0006): agent runs on your own
// Anthropic, OpenAI or Google key report tokens, not dollars, so their cost is an estimate from Viral's price table,
// and a model without a price keeps its tokens with no cost at all ("price unknown", never $0). Two new nullable
// columns; existing rows read as null (their cost was reported).
export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`ALTER TABLE stage_runs ADD COLUMN cost_basis TEXT CHECK (cost_basis IN ('reported', 'estimate', 'unknown'))`)
  yield* sql.unsafe(`ALTER TABLE eval_runs ADD COLUMN cost_basis TEXT CHECK (cost_basis IN ('reported', 'estimate', 'unknown'))`)
})
