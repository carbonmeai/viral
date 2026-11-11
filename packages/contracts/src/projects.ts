import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { ApproachName } from "./approaches.ts"
import { MusicTrackId, MusicTrackNotFound } from "./music-library.ts"
import { PresetId, PresetNotFound } from "./presets.ts"
import { MAX_SHORT_SOURCES, SourceId, SourceNotFound, SourceSetId, VideoSetNotFound } from "./sources.ts"

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type

// narrated: new third-person voiceover over b-roll. cut-down: the creator's own speech, spliced by beat. ranking: a
// numbered list of clips from the short's videos, each with its own sound, #1 last. Always derived from the approach.
export const ProjectFormat = Schema.Literals(["narrated", "cut-down", "ranking"])
export type ProjectFormat = typeof ProjectFormat.Type

// The videos a short draws from, in order (V1 first): one for most shorts, up to 10.
export const ProjectSourceIds = Schema.NonEmptyArray(SourceId).check(Schema.isMaxLength(MAX_SHORT_SOURCES))

// One short made from one or more videos.
export const Project = Schema.Struct({
  id: ProjectId,
  // its videos, V1 first; a clip's `source` index points into this list
  sourceIds: ProjectSourceIds,
  // the video set it came from, if any
  setId: Schema.NullOr(SourceSetId),
  // 1, 2, 3… across the library (shorts made before multi-video kept their per-video numbers); gives the slug
  // its "07-" prefix
  number: Schema.Int,
  slug: Schema.String,
  title: Schema.String,
  approach: ApproachName,
  format: ProjectFormat,
  // null = use the default preset
  presetId: Schema.NullOr(PresetId),
  // null = no music: a voice-only short is a normal choice
  musicTrackId: Schema.NullOr(MusicTrackId),
  // the ElevenLabs voice for the voiceover; null = the preset's voice
  voiceId: Schema.NullOr(Schema.String),
  // what the short should achieve, in your words ("focus on the friend's reactions"); steers its agents
  brief: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString
})
export type Project = typeof Project.Type

export class ProposalNotFound extends Schema.TaggedError<ProposalNotFound>()("ProposalNotFound", {
  sourceId: SourceId,
  proposal: Schema.Int
}) {}

export class SetProposalNotFound extends Schema.TaggedError<SetProposalNotFound>()("SetProposalNotFound", {
  setId: SourceSetId,
  proposal: Schema.Int
}) {}

// The videos asked for don't make a short: none, more than 10, one twice, or several without a brief (it's how
// the agents know why they belong together).
export class ProjectSourcesInvalid extends Schema.TaggedError<ProjectSourcesInvalid>()("ProjectSourcesInvalid", {
  message: Schema.String
}) {}

// A video can't leave a short: the current work of a step uses it (or a video added after it, whose place would
// move), or a run is working on the short. `message` says which, plainly.
export class ProjectSourceInUse extends Schema.TaggedError<ProjectSourceInUse>()("ProjectSourceInUse", {
  message: Schema.String
}) {}

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: ProjectId
}) {}

export class ProjectsRpcs extends RpcGroup.make(
  // A short from your videos, V1 first; a brief is required when there are several.
  Rpc.make("CreateProject", {
    payload: {
      sourceIds: Schema.NonEmptyArray(SourceId),
      title: Schema.String,
      approach: ApproachName,
      presetId: Schema.NullOr(PresetId),
      musicTrackId: Schema.NullOr(MusicTrackId),
      brief: Schema.optionalKey(Schema.NullOr(Schema.String))
    },
    success: Project,
    error: Schema.Union([SourceNotFound, PresetNotFound, MusicTrackNotFound, ProjectSourcesInvalid])
  }),
  // Creates a short from one of the story stage's proposals: its approach, with the proposal's title. `approach`
  // makes it another way instead (a single-video approach, e.g. "story-recap": the whole story with a long real ending).
  Rpc.make("CreateProjectFromProposal", {
    payload: {
      sourceId: SourceId,
      proposal: Schema.Int,
      brief: Schema.optionalKey(Schema.NullOr(Schema.String)),
      approach: Schema.optionalKey(ApproachName)
    },
    success: Project,
    error: Schema.Union([SourceNotFound, ProposalNotFound])
  }),
  // Creates a short from one of a video set's proposals: its approach and title, the videos it uses (in set
  // order), and the set's brief unless you give another. `approach` makes it another way instead ("narrated-ranking" or
  // "ranking": a ranking of every video in the set).
  Rpc.make("CreateProjectFromSetProposal", {
    payload: {
      setId: SourceSetId,
      proposal: Schema.Int,
      brief: Schema.optionalKey(Schema.NullOr(Schema.String)),
      approach: Schema.optionalKey(ApproachName)
    },
    success: Project,
    error: Schema.Union([VideoSetNotFound, SetProposalNotFound, ProjectSourcesInvalid])
  }),
  // Sets what the short should achieve (null or blank clears it). It steers the agents from their next run.
  Rpc.make("SetProjectBrief", {
    payload: { id: ProjectId, brief: Schema.NullOr(Schema.String) },
    success: Project,
    error: ProjectNotFound
  }),
  // Renames the short (its title in the editor and your lists; trimmed, a blank one keeps the old title). Its folder
  // and files keep their names, and the post's title is still chosen at Publish.
  Rpc.make("RenameProject", {
    payload: { id: ProjectId, title: Schema.String },
    success: Project,
    error: ProjectNotFound
  }),
  // Adds a video to the short, after its others (up to 10). Nothing re-runs: the next run reads the video first (when
  // it hasn't been) and its steps can use it.
  Rpc.make("AddSourceToProject", {
    payload: { id: ProjectId, sourceId: SourceId },
    success: Project,
    error: Schema.Union([ProjectNotFound, SourceNotFound, ProjectSourcesInvalid])
  }),
  // Takes a video out of the short. Refused while a step's current work uses it (ProjectSourceInUse names the steps),
  // and for the short's only video (ProjectSourcesInvalid).
  Rpc.make("RemoveSourceFromProject", {
    payload: { id: ProjectId, sourceId: SourceId },
    success: Project,
    error: Schema.Union([ProjectNotFound, ProjectSourcesInvalid, ProjectSourceInUse])
  }),
  // Picks the short's style (null = the default preset).
  Rpc.make("SetProjectPreset", {
    payload: { id: ProjectId, presetId: Schema.NullOr(PresetId) },
    success: Project,
    error: Schema.Union([ProjectNotFound, PresetNotFound])
  }),
  // Picks the short's music track (null = voice only).
  Rpc.make("SetProjectMusic", {
    payload: { id: ProjectId, musicTrackId: Schema.NullOr(MusicTrackId) },
    success: Project,
    error: Schema.Union([ProjectNotFound, MusicTrackNotFound])
  }),
  // Picks the voiceover's voice for this short (null = back to the preset's voice).
  Rpc.make("SetProjectVoice", {
    payload: { id: ProjectId, voiceId: Schema.NullOr(Schema.String) },
    success: Project,
    error: ProjectNotFound
  }),
  // Every short, or the shorts that use one video.
  Rpc.make("ListProjects", { payload: { sourceId: Schema.NullOr(SourceId) }, success: Schema.Array(Project) }),
  Rpc.make("GetProject", { payload: { id: ProjectId }, success: Project, error: ProjectNotFound }),
  // Deletes the short and its folder; false when the project is unknown.
  Rpc.make("DeleteProject", { payload: { id: ProjectId }, success: Schema.Boolean })
) {}
