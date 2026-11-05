import { JobsRpcs } from "./jobs.ts"
import { PipelineRpcs } from "./pipeline.ts"

// Everything the server exposes over its WebSocket; each domain owns its own group.
export const ViralRpcs = JobsRpcs.merge(PipelineRpcs)
