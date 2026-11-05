import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { MusicTrackId, MusicTrackNotFound } from "./music-library.ts"
import { PresetId, PresetNotFound } from "./presets.ts"
import { SourceId, SourceNotFound } from "./sources.ts"

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type

// narrated: new third-person voiceover over b-roll. cut-down: the creator's own speech, spliced by beat.
export const ProjectFormat = Schema.Literals(["narrated", "cut-down"])
export type ProjectFormat = typeof ProjectFormat.Type

// One short made from a source.
export const Project = Schema.Struct({
  id: ProjectId,
  sourceId: SourceId,
  // 1, 2, 3… within the source; gives the slug its "01-" prefix
  number: Schema.Int,
  slug: Schema.String,
  title: Schema.String,
  format: ProjectFormat,
  // null = use the default preset
  presetId: Schema.NullOr(PresetId),
  // null = the music stage asks for a track, or the short goes without music
  musicTrackId: Schema.NullOr(MusicTrackId),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString
})
export type Project = typeof Project.Type

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: ProjectId
}) {}

export class ProjectsRpcs extends RpcGroup.make(
  Rpc.make("CreateProject", {
    payload: {
      sourceId: SourceId,
      title: Schema.String,
      format: ProjectFormat,
      presetId: Schema.NullOr(PresetId),
      musicTrackId: Schema.NullOr(MusicTrackId)
    },
    success: Project,
    error: Schema.Union([SourceNotFound, PresetNotFound, MusicTrackNotFound])
  }),
  Rpc.make("ListProjects", { payload: { sourceId: Schema.NullOr(SourceId) }, success: Schema.Array(Project) }),
  Rpc.make("GetProject", { payload: { id: ProjectId }, success: Project, error: ProjectNotFound }),
  // Deletes the short and its folder; false when the project is unknown.
  Rpc.make("DeleteProject", { payload: { id: ProjectId }, success: Schema.Boolean })
) {}
