import { Rights, SoundCategory, type SoundEffect, SoundEffectId, SoundEffectNotFound, SoundEffectOrigin } from "@viral/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"

const EffectRow = Schema.Struct({
  id: SoundEffectId,
  category: SoundCategory,
  name: Schema.String,
  path: Schema.String,
  duration_s: Schema.Finite,
  loudness_lufs: Schema.NullOr(Schema.Finite),
  origin: Schema.fromJsonString(SoundEffectOrigin),
  rights: Rights,
  created_at: Schema.DateTimeUtcFromString
})
const toEffect = (row: typeof EffectRow.Type): SoundEffect => ({
  id: row.id,
  category: row.category,
  name: row.name,
  path: row.path,
  durationS: row.duration_s,
  loudnessLufs: row.loudness_lufs,
  origin: row.origin,
  rights: row.rights,
  createdAt: row.created_at
})

// Sound-effect samples by category, each with several variants so repeated cues don't sound copied.
// Files live in ~/.viral/sounds/. Importing, normalising and generating effects come with the library's
// import step; this is the read side the sound stage uses.
export class SoundLibrary extends Context.Service<SoundLibrary, {
  list(category: SoundCategory | null): Effect.Effect<ReadonlyArray<SoundEffect>>
  get(id: SoundEffectId): Effect.Effect<SoundEffect, SoundEffectNotFound>
}>()("@viral/server/sound-library/sound-library/SoundLibrary") {
  static readonly layer = Layer.effect(
    SoundLibrary,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: EffectRow,
        execute: () => sql`SELECT * FROM sound_effects ORDER BY category, name`
      })
      const findByCategory = SqlSchema.findAll({
        Request: SoundCategory,
        Result: EffectRow,
        execute: (category) => sql`SELECT * FROM sound_effects WHERE category = ${category} ORDER BY name`
      })
      const findById = SqlSchema.findOneOption({
        Request: SoundEffectId,
        Result: EffectRow,
        execute: (id) => sql`SELECT * FROM sound_effects WHERE id = ${id}`
      })

      const list = Effect.fn("SoundLibrary.list")(function*(category: SoundCategory | null) {
        const rows = yield* Option.match(Option.fromNullishOr(category), {
          onNone: () => findAll(),
          onSome: findByCategory
        }).pipe(Effect.orDie)
        return rows.map(toEffect)
      })

      const get = Effect.fn("SoundLibrary.get")(function*(id: SoundEffectId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None") return yield* new SoundEffectNotFound({ id })
        return toEffect(row.value)
      })

      return SoundLibrary.of({ list, get })
    })
  ).pipe(Layer.provide(DatabaseLive))
}
