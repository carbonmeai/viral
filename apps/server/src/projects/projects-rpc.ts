import { ProjectsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Projects } from "./projects.ts"

export const ProjectsRpcLive = ProjectsRpcs.toLayer(Effect.gen(function*() {
  const projects = yield* Projects
  return ProjectsRpcs.of({
    CreateProject: (input) => projects.create(input),
    CreateProjectFromProposal: ({ sourceId, proposal, brief }) => projects.fromProposal(sourceId, proposal, brief),
    CreateProjectFromSetProposal: ({ setId, proposal, brief }) => projects.fromSetProposal(setId, proposal, brief),
    SetProjectBrief: ({ id, brief }) => projects.setBrief(id, brief),
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
