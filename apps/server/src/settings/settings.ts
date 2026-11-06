import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"

const Json = Schema.fromJsonString(Schema.Unknown)

// App-wide preferences as JSON values under string keys, e.g. "stage.story.model". A value that doesn't
// match the schema the caller expects reads as absent rather than failing.
export class Settings extends Context.Service<Settings, {
  get<S extends Schema.Top>(key: string, schema: S): Effect.Effect<Option.Option<S["Type"]>, never, S["DecodingServices"]>
  set(key: string, value: unknown): Effect.Effect<void>
}>()("@viral/server/settings/settings") {
  static readonly layer = Layer.effect(
    Settings,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const find = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ value: Json }),
        execute: (key) => sql`SELECT value FROM settings WHERE key = ${key}`
      })

      const get = Effect.fn("Settings.get")(function*<S extends Schema.Top>(key: string, schema: S) {
        const row = yield* find(key).pipe(Effect.orDie)
        if (Option.isNone(row)) return Option.none<S["Type"]>()
        return yield* Schema.decodeUnknownEffect(schema)(row.value.value).pipe(Effect.option)
      })

      const set = Effect.fn("Settings.set")(function*(key: string, value: unknown) {
        const encoded = yield* Schema.encodeEffect(Json)(value)
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${encoded}, ${now})
          ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `
      }, Effect.orDie)

      return Settings.of({ get, set })
    })
  ).pipe(Layer.provide(DatabaseLive))
}
