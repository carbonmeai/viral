import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// Research mode, as designed in docs/plans/database-schema.md (0004): a video set found from an idea keeps the idea,
// how many videos and the length in a new table, one row per set. The shortlist is a set artifact, and the approved
// videos are ordinary set members, so no existing table changes.
export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`
    CREATE TABLE source_set_research (
      set_id      TEXT PRIMARY KEY REFERENCES source_sets (id) ON DELETE CASCADE,
      idea        TEXT NOT NULL,
      videos      INTEGER NOT NULL CHECK (videos IN (3, 5, 7, 10)),
      length      TEXT NOT NULL CHECK (length IN ('60', '180', 'any')),
      created_at  TEXT NOT NULL
    )
  `)
})
