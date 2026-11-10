import { Rights, SoundCategory, type SoundEffect, SoundEffectId, SoundEffectNotFound, SoundEffectOrigin } from "@viral/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { NodeServices } from "@effect/platform-node"
import { ViralHome } from "../home/viral-home.ts"
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

// A new sound for the library: its mp3, where it came from, and how long it plays.
export interface NewSound {
  readonly category: SoundCategory
  // a name made from the prompt ("short-whoosh-bass-hit"); a variant number is added ("-01", "-02"…)
  readonly stem: string
  readonly audio: Uint8Array
  readonly durationS: number
  readonly origin: SoundEffectOrigin
  readonly rights: Rights
}

// "A short whoosh that swells into a deep bass hit." → "short-whoosh-swells-deep" (at most four words that say
// something, lower-case, ASCII).
const FILLER = new Set(["a", "an", "the", "that", "into", "with", "and", "of", "on", "in", "to", "for", "like", "very", "some"])
export const soundStem = (prompt: string) => {
  const words = prompt.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((w) => w !== "" && !FILLER.has(w))
  return words.slice(0, 4).join("-") || "sound"
}

// The next free variant of a stem among a category's names: "whoosh-01", then "whoosh-02"…
export const nextVariant = (stem: string, taken: ReadonlyArray<string>) => {
  for (let n = 1;; n++) {
    const name = `${stem}-${String(n).padStart(2, "0")}`
    if (!taken.includes(name)) return name
  }
}

// Sound-effect samples by category, each with several variants so repeated cues don't sound copied.
// Files live in ~/.viral/sounds/<category>/. The generator (Library › Create › Sound effect) adds to it; placing
// sounds on a short waits for the sound-design plan.
export class SoundLibrary extends Context.Service<SoundLibrary, {
  list(category: SoundCategory | null): Effect.Effect<ReadonlyArray<SoundEffect>>
  get(id: SoundEffectId): Effect.Effect<SoundEffect, SoundEffectNotFound>
  add(sound: NewSound): Effect.Effect<SoundEffect>
  // removes a sound and its file; false when there's no such sound. Bundled sounds aren't removed (false).
  remove(id: SoundEffectId): Effect.Effect<boolean>
}>()("@viral/server/sound-library/sound-library/SoundLibrary") {
  static readonly layer = Layer.effect(
    SoundLibrary,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const home = yield* ViralHome
      const random = yield* SecureRandom.SecureRandom

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

      const add = Effect.fn("SoundLibrary.add")(function*(sound: NewSound) {
        const taken = (yield* findByCategory(sound.category).pipe(Effect.orDie)).map((r) => r.name)
        const name = nextVariant(sound.stem, taken)
        const relative = path.join(sound.category, `${name}.mp3`)
        yield* fs.makeDirectory(path.join(home.sounds, sound.category), { recursive: true }).pipe(Effect.orDie)
        yield* fs.writeFile(path.join(home.sounds, relative), sound.audio).pipe(Effect.orDie)
        const id = SoundEffectId.make(yield* random.uuidV7())
        const now = DateTime.formatIso(yield* DateTime.now)
        const origin = yield* Schema.encodeEffect(Schema.fromJsonString(SoundEffectOrigin))(sound.origin).pipe(Effect.orDie)
        yield* sql`
          INSERT INTO sound_effects (id, category, name, path, duration_s, loudness_lufs, origin, rights, created_at)
          VALUES (${id}, ${sound.category}, ${name}, ${relative}, ${sound.durationS}, ${null},
                  ${origin}, ${sound.rights}, ${now})
        `.pipe(Effect.orDie)
        return yield* get(id).pipe(Effect.orDie)
      })

      const remove = Effect.fn("SoundLibrary.remove")(function*(id: SoundEffectId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None" || row.value.origin._tag === "Bundled") return false
        yield* sql`DELETE FROM sound_effects WHERE id = ${id}`.pipe(Effect.orDie)
        yield* fs.remove(path.join(home.sounds, row.value.path), { force: true }).pipe(Effect.ignore)
        return true
      })

      return SoundLibrary.of({ list, get, add, remove })
    })
  ).pipe(Layer.provide([DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto]))
}
