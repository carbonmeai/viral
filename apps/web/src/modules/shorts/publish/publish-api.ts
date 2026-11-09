import type { ProjectId } from "@viral/contracts"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../../api/client.ts"

// A published short's post text and what "Publish again" would update. A save on the short refreshes it.
export const publishStatusAtom = Atom.family((projectId: ProjectId) =>
  ViralClient.query("GetPublishStatus", { projectId }, { reactivityKeys: [`short:${projectId}`, `publish:${projectId}`] })
)

export const setPostText = ViralClient.mutation("SetPostText")
export const publishAgain = ViralClient.mutation("PublishAgain")
