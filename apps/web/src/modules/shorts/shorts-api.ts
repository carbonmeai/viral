import { type ProjectId, SourceId } from "@viral/contracts"
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

// Stills of the long video around a source second, for picking a shot's frame (key: "<source>|<second>|<span>").
export const framesAroundAtom = Atom.family((key: string) => {
  const [sourceId, t, span] = key.split("|")
  return ViralClient.query("ListFramesAround", { sourceId: SourceId.make(sourceId ?? ""), t: Number(t), span: Number(span), every: 1 })
})
export const framesKey = (sourceId: SourceId, t: number, span: number) => `${sourceId}|${Math.round(t)}|${span}`

// Writes.
export const respondToRequest = ViralClient.mutation("RespondToRequest")
export const checkScriptEdit = ViralClient.mutation("CheckScriptEdit")
export const checkShotsEdit = ViralClient.mutation("CheckShotsEdit")
export const checkThumbnailEdit = ViralClient.mutation("CheckThumbnailEdit")
export const checkSectionsEdit = ViralClient.mutation("CheckSectionsEdit")
// a ranking's moments: checked and snapped to whole sentences; the snapped ranking comes back
export const checkRankingEdit = ViralClient.mutation("CheckRankingEdit")
// a still of the long video at one second, fetched on demand (a section whose start you moved)
export const stillAt = ViralClient.mutation("ListFramesAround")
export const setProjectVoice = ViralClient.mutation("SetProjectVoice")
export const setProjectBrief = ViralClient.mutation("SetProjectBrief")
export const startShortRun = ViralClient.mutation("StartProjectRun")

// The short's fitted music bed (null: voice only). Refreshed by the editor when assemble fits a new one.
export const musicBedAtom = Atom.family((projectId: ProjectId) =>
  ViralClient.query("GetMusicBed", { projectId }, { reactivityKeys: [`short:${projectId}`] })
)
export const refitMusic = ViralClient.mutation("RefitMusic")
export const cancelRun = ViralClient.mutation("CancelRun")
// the short's music arrangement: set it (null: automatic, re-runs from assemble), or hear it first
export const arrangeMusic = ViralClient.mutation("ArrangeMusic")
export const previewMusicArrangement = ViralClient.mutation("PreviewMusicArrangement")
// a video added to the short, or taken out of it
export const addSourceToProject = ViralClient.mutation("AddSourceToProject")
export const removeSourceFromProject = ViralClient.mutation("RemoveSourceFromProject")
