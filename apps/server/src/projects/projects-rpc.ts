import { ProjectsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Projects } from "./projects.ts"

export const ProjectsRpcLive = ProjectsRpcs.toLayer(Effect.gen(function*() {
  const projects = yield* Projects
  return ProjectsRpcs.of({
    CreateProject: (input) => projects.create(input),
    CreateProjectFromProposal: ({ sourceId, proposal, brief, approach }) => projects.fromProposal(sourceId, proposal, brief, approach),
    CreateProjectFromSetProposal: ({ setId, proposal, brief, approach }) => projects.fromSetProposal(setId, proposal, brief, approach),
    SetProjectBrief: ({ id, brief }) => projects.setBrief(id, brief),
    RenameProject: ({ id, title }) => projects.rename(id, title),
    AddSourceToProject: ({ id, sourceId }) => projects.addSource(id, sourceId),
    RemoveSourceFromProject: ({ id, sourceId }) => projects.removeSource(id, sourceId),
    SetProjectPreset: ({ id, presetId }) => projects.setPreset(id, presetId),
    SetProjectMusic: ({ id, musicTrackId }) => projects.setMusic(id, musicTrackId),
    SetProjectVoice: ({ id, voiceId }) => projects.setVoice(id, voiceId),
    ListProjects: ({ sourceId }) => projects.list(sourceId),
    GetProject: ({ id }) => projects.get(id),
    DeleteProject: ({ id }) => projects.remove(id)
  })
}))
