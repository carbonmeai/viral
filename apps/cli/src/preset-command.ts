import { Preset, PresetId } from "@viral/contracts"
import { Console, Effect } from "effect"
import { positionals } from "./args.ts"
import { Client } from "./client.ts"
import { show } from "./show.ts"

export const PRESET_USAGE = `  preset list | show <id> | default <id> | delete <id>`

const describe = (preset: Preset) => `${preset.id}  ${preset.isDefault ? "*" : " "} ${preset.name}`

export const presetCommand = Effect.fn("presetCommand")(function*() {
  const client = yield* Client
  const [, sub = "list", id = ""] = positionals

  switch (sub) {
    case "list":
      return yield* Effect.forEach(yield* client.ListPresets(), (p) => Console.log(describe(p)), { discard: true })
    case "show":
      return yield* show(Preset)(yield* client.GetPreset({ id: PresetId.make(id) }))
    case "default":
      return yield* Console.log(describe(yield* client.SetDefaultPreset({ id: PresetId.make(id) })))
    case "delete":
      return yield* Console.log(`deleted: ${yield* client.DeletePreset({ id: PresetId.make(id) })}`)
    default:
      return yield* Console.error(PRESET_USAGE)
  }
})
