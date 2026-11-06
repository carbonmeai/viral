import { ShortWorkspaceRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { ShortWorkspaces } from "./short-workspace.ts"

export const ShortWorkspaceRpcLive = ShortWorkspaceRpcs.toLayer(Effect.gen(function*() {
  const workspaces = yield* ShortWorkspaces
  return ShortWorkspaceRpcs.of({
    GetShortWorkspace: ({ projectId }) => workspaces.get(projectId),
    CheckScriptEdit: ({ projectId, script }) => Effect.map(workspaces.checkScript(projectId, script), (problems) => ({ problems }))
  })
}))
