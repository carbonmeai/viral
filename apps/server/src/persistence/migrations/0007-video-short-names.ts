import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// A video's short name, as designed in docs/plans/database-schema.md (0007): the name you gave it for the editor's
// lanes and the colour-dot badges ("Heidi"). One nullable column; existing rows read as null (made from the title).
export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`ALTER TABLE sources ADD COLUMN short_name TEXT`)
})
