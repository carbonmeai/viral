import type { ProjectId } from "@viral/contracts"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"

export const projectAtom = Atom.family((id: ProjectId) => ViralClient.query("GetProject", { id }, { reactivityKeys: [`project:${id}`] }))
export const projectRunsAtom = Atom.family((id: ProjectId) =>
  ViralClient.query("ListRuns", { owner: { _tag: "Project", id } }, { reactivityKeys: [`project:${id}`] })
)

// The short's editor: everything it shows, in one call. A save on the short refreshes it (key `short:<id>`).
export const workspaceAtom = Atom.family((projectId: ProjectId) =>
  ViralClient.query("GetShortWorkspace", { projectId }, { reactivityKeys: [`short:${projectId}`] })
)

// Writes.
export const respondToRequest = ViralClient.mutation("RespondToRequest")
export const checkScriptEdit = ViralClient.mutation("CheckScriptEdit")
export const setProjectVoice = ViralClient.mutation("SetProjectVoice")
