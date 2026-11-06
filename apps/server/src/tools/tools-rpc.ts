import { ToolsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Tools } from "./tools.ts"

export const ToolsRpcLive = ToolsRpcs.toLayer(Effect.gen(function*() {
  const tools = yield* Tools
  return ToolsRpcs.of({
    ListTools: () => tools.list,
    InstallTools: () => tools.install
  })
}))
