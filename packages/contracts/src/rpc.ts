import { ArtifactsRpcs } from "./artifacts.ts"
import { MusicLibraryRpcs } from "./music-library.ts"
import { PresetsRpcs } from "./presets.ts"
import { ProjectsRpcs } from "./projects.ts"
import { ReferencesRpcs } from "./references.ts"
import { RunsRpcs } from "./runs.ts"
import { SoundLibraryRpcs } from "./sound-library.ts"
import { SourcesRpcs } from "./sources.ts"
import { ToolsRpcs } from "./tools.ts"
import { VoicesRpcs } from "./voices.ts"

// Everything the server exposes over its WebSocket; each domain owns its own group.
export const ViralRpcs = SourcesRpcs.merge(ProjectsRpcs, PresetsRpcs, MusicLibraryRpcs, ArtifactsRpcs, SoundLibraryRpcs, ReferencesRpcs, RunsRpcs, VoicesRpcs, ToolsRpcs)
