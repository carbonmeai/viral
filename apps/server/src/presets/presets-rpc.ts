import { PresetsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Presets } from "./presets.ts"

export const PresetsRpcLive = PresetsRpcs.toLayer(Effect.gen(function*() {
  const presets = yield* Presets
  return PresetsRpcs.of({
    ListPresets: () => presets.list,
    GetPreset: ({ id }) => presets.get(id),
    CreatePreset: ({ name, config }) => presets.create(name, config),
    SetDefaultPreset: ({ id }) => presets.setDefault(id),
    UpdatePreset: ({ id, config }) => presets.edit(id, config),
    RenamePreset: ({ id, name }) => presets.rename(id, name),
    DeletePreset: ({ id }) => presets.remove(id)
  })
}))
