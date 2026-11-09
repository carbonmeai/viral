import { ArtifactsRpcs } from "./artifacts.ts"
import { PublishRpcs } from "./metadata.ts"
import { MusicLibraryRpcs } from "./music-library.ts"
import { PresetsRpcs } from "./presets.ts"
import { ProjectsRpcs } from "./projects.ts"
import { ReferencesRpcs } from "./references.ts"
import { RunsRpcs } from "./runs.ts"
import { SoundLibraryRpcs } from "./sound-library.ts"
import { SettingsRpcs } from "./settings.ts"
import { ShortWorkspaceRpcs } from "./short-workspace.ts"
import { SourceOverviewRpcs } from "./source-overview.ts"
import { SourcesRpcs } from "./sources.ts"
import { MusicBedsRpcs } from "./music-bed.ts"
import { ToolsRpcs } from "./tools.ts"
import { VideoSetsRpcs } from "./video-sets.ts"
import { VoicesRpcs } from "./voices.ts"

// Everything the server exposes over its WebSocket; each domain owns its own group.
export const ViralRpcs = SourcesRpcs.merge(ProjectsRpcs, PresetsRpcs, MusicLibraryRpcs, ArtifactsRpcs, SoundLibraryRpcs, ReferencesRpcs, RunsRpcs, VoicesRpcs, ToolsRpcs, SettingsRpcs, SourceOverviewRpcs, ShortWorkspaceRpcs, MusicBedsRpcs, VideoSetsRpcs, PublishRpcs)
