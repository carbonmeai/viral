import { ShortWorkspaceRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { FramesAround } from "../contact-sheet/frames-around.ts"
import { ShortWorkspaces } from "./short-workspace.ts"

export const ShortWorkspaceRpcLive = ShortWorkspaceRpcs.toLayer(Effect.gen(function*() {
  const workspaces = yield* ShortWorkspaces
  const frames = yield* FramesAround
  return ShortWorkspaceRpcs.of({
    GetShortWorkspace: ({ projectId }) => workspaces.get(projectId),
    CheckScriptEdit: ({ projectId, script }) => Effect.map(workspaces.checkScript(projectId, script), (problems) => ({ problems })),
    CheckShotsEdit: ({ projectId, proposal }) => Effect.map(workspaces.checkShots(projectId, proposal), (problems) => ({ problems })),
    CheckSectionsEdit: ({ projectId, proposal }) => Effect.map(workspaces.checkSections(projectId, proposal), (problems) => ({ problems })),
    CheckRankingEdit: ({ projectId, proposal }) => workspaces.checkRanking(projectId, proposal),
    CheckThumbnailEdit: ({ projectId, config }) => Effect.map(workspaces.checkThumbnail(projectId, config), (problems) => ({ problems })),
    ListFramesAround: ({ sourceId, t, span, every }) => Effect.map(frames.list(sourceId, t, span, every), (list) => ({ frames: list }))
  })
}))
