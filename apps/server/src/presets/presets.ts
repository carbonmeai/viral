import {
  type Preset,
  PresetConfig,
  PresetId,
  PresetIsDefault,
  PresetNameTaken,
  PresetNotFound
} from "@viral/contracts"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"
import { DEFAULT_PRESET_CONFIG, DEFAULT_PRESET_NAME } from "./default-preset.ts"

const ConfigJson = Schema.fromJsonString(PresetConfig)

const PresetRow = Schema.Struct({
  id: PresetId,
  name: Schema.String,
  is_default: Schema.Literals([0, 1]),
  config: ConfigJson,
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString
})
const toPreset = (row: typeof PresetRow.Type): Preset => ({
  id: row.id,
  name: row.name,
  isDefault: row.is_default === 1,
  config: row.config,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

// Style profiles. Exactly one is the default (enforced by a partial unique index); a short with no
// preset uses it. The default preset is seeded the first time the server starts.
export class Presets extends Context.Service<Presets, {
  readonly list: Effect.Effect<ReadonlyArray<Preset>>
  get(id: PresetId): Effect.Effect<Preset, PresetNotFound>
  readonly getDefault: Effect.Effect<Preset>
  create(name: string, config: PresetConfig): Effect.Effect<Preset, PresetNameTaken>
  setDefault(id: PresetId): Effect.Effect<Preset, PresetNotFound>
  remove(id: PresetId): Effect.Effect<boolean, PresetIsDefault>
}>()("@viral/server/presets/presets") {
  static readonly layer = Layer.effect(
    Presets,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const random = yield* SecureRandom.SecureRandom

      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: PresetRow,
        execute: () => sql`SELECT * FROM presets ORDER BY is_default DESC, name`
      })
      const findById = SqlSchema.findOneOption({
        Request: PresetId,
        Result: PresetRow,
        execute: (id) => sql`SELECT * FROM presets WHERE id = ${id}`
      })
      const findDefault = SqlSchema.findOne({
        Request: Schema.Void,
        Result: PresetRow,
        execute: () => sql`SELECT * FROM presets WHERE is_default = 1`
      })

      const insert = Effect.fn("Presets.insert")(function*(name: string, config: PresetConfig, isDefault: boolean) {
        const id = PresetId.make(yield* random.uuidV7())
        const now = DateTime.formatIso(yield* DateTime.now)
        const encoded = yield* Schema.encodeEffect(ConfigJson)(config).pipe(Effect.orDie)
        yield* sql`
          INSERT INTO presets (id, name, is_default, config, created_at, updated_at)
          VALUES (${id}, ${name}, ${isDefault ? 1 : 0}, ${encoded}, ${now}, ${now})
        `
        return id
      })

      // Seed on first start.
      const countPresets = SqlSchema.findOne({
        Request: Schema.Void,
        Result: Schema.Struct({ count: Schema.Int }),
        execute: () => sql`SELECT count(*) AS count FROM presets`
      })
      const { count } = yield* countPresets().pipe(Effect.orDie)
      if (count === 0) yield* insert(DEFAULT_PRESET_NAME, DEFAULT_PRESET_CONFIG, true).pipe(Effect.orDie)

      const get = Effect.fn("Presets.get")(function*(id: PresetId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None") return yield* new PresetNotFound({ id })
        return toPreset(row.value)
      })

      const list = findAll().pipe(Effect.map((rows) => rows.map(toPreset)), Effect.orDie, Effect.withSpan("Presets.list"))
      const getDefault = findDefault().pipe(Effect.map(toPreset), Effect.orDie, Effect.withSpan("Presets.getDefault"))

      const create = Effect.fn("Presets.create")(function*(name: string, config: PresetConfig) {
        const taken = yield* sql`SELECT 1 FROM presets WHERE name = ${name}`.pipe(Effect.orDie)
        if (taken.length > 0) return yield* new PresetNameTaken({ presetName: name })
        const id = yield* insert(name, config, false).pipe(Effect.orDie)
        return yield* get(id).pipe(Effect.orDie)
      })

      // Clearing the old default and setting the new one happen in one transaction, so the
      // one-default index never sees two (or zero).
      const setDefault = Effect.fn("Presets.setDefault")(function*(id: PresetId) {
        yield* get(id)
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`UPDATE presets SET is_default = 0, updated_at = ${now} WHERE is_default = 1`
          yield* sql`UPDATE presets SET is_default = 1, updated_at = ${now} WHERE id = ${id}`
        })).pipe(Effect.orDie)
        return yield* get(id)
      })

      const remove = Effect.fn("Presets.remove")(function*(id: PresetId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None") return false
        if (row.value.is_default === 1) return yield* new PresetIsDefault({ id })
        yield* sql`DELETE FROM presets WHERE id = ${id}`.pipe(Effect.orDie)
        return true
      })

      return Presets.of({ list, get, getDefault, create, setDefault, remove })
    })
  ).pipe(Layer.provide([DatabaseLive, SecureRandom.layerWebCrypto]))
}
