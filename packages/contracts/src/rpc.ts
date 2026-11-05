import { JobsRpcs } from "./jobs.ts"
import { MusicLibraryRpcs } from "./music-library.ts"
import { PipelineRpcs } from "./pipeline.ts"
import { PresetsRpcs } from "./presets.ts"
import { ProjectsRpcs } from "./projects.ts"
import { SourcesRpcs } from "./sources.ts"

// Everything the server exposes over its WebSocket; each domain owns its own group.
export const ViralRpcs = JobsRpcs.merge(PipelineRpcs, SourcesRpcs, ProjectsRpcs, PresetsRpcs, MusicLibraryRpcs)
