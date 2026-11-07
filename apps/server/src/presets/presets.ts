import {
  type Preset,
  PresetConfig,
  PresetId,
  PresetInvalid,
  PresetIsDefault,
  PresetNameTaken,
  PresetNotFound
} from "@viral/contracts"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"
import { BUILT_IN_PRESETS, DEFAULT_PRESET_NAME } from "./built-in-presets.ts"
import { checkPresetConfig, checkPresetName } from "./preset-rules.ts"

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

// Style profiles: how a short looks and sounds. Exactly one is the default (enforced by a partial unique
// index); a short with no preset uses it. The built-in presets are ensured by name on every start.
export class Presets extends Context.Service<Presets, {
  readonly list: Effect.Effect<ReadonlyArray<Preset>>
  get(id: PresetId): Effect.Effect<Preset, PresetNotFound>
  readonly getDefault: Effect.Effect<Preset>
  create(name: string, config: PresetConfig): Effect.Effect<Preset, PresetNameTaken>
  setDefault(id: PresetId): Effect.Effect<Preset, PresetNotFound>
  // replaces a preset's settings, e.g. the default style's voice from Library › Voices (Set as default)
  updateConfig(id: PresetId, config: PresetConfig): Effect.Effect<Preset, PresetNotFound>
  // a style's settings from the Styles page: checked first, refused with every problem
  edit(id: PresetId, config: PresetConfig): Effect.Effect<Preset, PresetNotFound | PresetInvalid>
  rename(id: PresetId, name: string): Effect.Effect<Preset, PresetNotFound | PresetNameTaken | PresetInvalid>
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

      // Add any built-in preset that's missing (never overwrite one you've edited), and make "Viral recap"
      // the default when nothing is the default yet.
      const names = new Set((yield* sql<{ readonly name: string }>`SELECT name FROM presets`.pipe(Effect.orDie)).map((r) => r.name))
      const hasDefault = (yield* sql`SELECT 1 FROM presets WHERE is_default = 1`.pipe(Effect.orDie)).length > 0
      yield* Effect.forEach(BUILT_IN_PRESETS.filter((preset) => !names.has(preset.name)), (preset) =>
        insert(preset.name, preset.config, !hasDefault && preset.name === DEFAULT_PRESET_NAME).pipe(Effect.orDie),
        { discard: true })

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

      const updateConfig = Effect.fn("Presets.updateConfig")(function*(id: PresetId, config: PresetConfig) {
        yield* get(id)
        const now = DateTime.formatIso(yield* DateTime.now)
        const encoded = yield* Schema.encodeEffect(ConfigJson)(config).pipe(Effect.orDie)
        yield* sql`UPDATE presets SET config = ${encoded}, updated_at = ${now} WHERE id = ${id}`.pipe(Effect.orDie)
        return yield* get(id)
      })

      const edit = Effect.fn("Presets.edit")(function*(id: PresetId, config: PresetConfig) {
        const problems = checkPresetConfig(config)
        if (problems.length > 0) return yield* new PresetInvalid({ problems })
        return yield* updateConfig(id, config)
      })

      const rename = Effect.fn("Presets.rename")(function*(id: PresetId, name: string) {
        const problems = checkPresetName(name)
        if (problems.length > 0) return yield* new PresetInvalid({ problems })
        const trimmed = name.trim()
        const current = yield* get(id)
        if (current.name === trimmed) return current
        const taken = yield* sql`SELECT 1 FROM presets WHERE name = ${trimmed} AND id != ${id}`.pipe(Effect.orDie)
        if (taken.length > 0) return yield* new PresetNameTaken({ presetName: trimmed })
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`UPDATE presets SET name = ${trimmed}, updated_at = ${now} WHERE id = ${id}`.pipe(Effect.orDie)
        return yield* get(id)
      })

      const remove = Effect.fn("Presets.remove")(function*(id: PresetId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None") return false
        if (row.value.is_default === 1) return yield* new PresetIsDefault({ id })
        yield* sql`DELETE FROM presets WHERE id = ${id}`.pipe(Effect.orDie)
        return true
      })

      return Presets.of({ list, get, getDefault, create, setDefault, updateConfig, edit, rename, remove })
    })
  ).pipe(Layer.provide([DatabaseLive, SecureRandom.layerWebCrypto]))
}
