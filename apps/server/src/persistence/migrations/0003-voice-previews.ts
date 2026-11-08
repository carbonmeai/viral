import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// "Try a line" previews' ElevenLabs characters, as designed in docs/plans/database-schema.md (0003): a new table,
// so Settings › Usage counts what previews spoke. They belong to no run or short.
export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`
    CREATE TABLE voice_previews (
      id          TEXT PRIMARY KEY,
      voice_id    TEXT NOT NULL,
      model       TEXT NOT NULL,
      characters  INTEGER NOT NULL,
      created_at  TEXT NOT NULL
    )
  `)
  yield* sql.unsafe("CREATE INDEX voice_previews_by_created ON voice_previews (created_at)")
})
