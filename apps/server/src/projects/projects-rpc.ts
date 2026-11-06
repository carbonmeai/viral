import { ProjectsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Projects } from "./projects.ts"

export const ProjectsRpcLive = ProjectsRpcs.toLayer(Effect.gen(function*() {
  const projects = yield* Projects
  return ProjectsRpcs.of({
    CreateProject: (input) => projects.create(input),
    CreateProjectFromProposal: ({ sourceId, proposal }) => projects.fromProposal(sourceId, proposal),
    SetProjectPreset: ({ id, presetId }) => projects.setPreset(id, presetId),
    SetProjectVoice: ({ id, voiceId }) => projects.setVoice(id, voiceId),
    ListProjects: ({ sourceId }) => projects.list(sourceId),
    GetProject: ({ id }) => projects.get(id),
    DeleteProject: ({ id }) => projects.remove(id)
  })
}))
