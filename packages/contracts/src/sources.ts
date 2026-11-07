import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Rights } from "./rights.ts"

export const SourceId = Schema.String.pipe(Schema.brand("SourceId"))
export type SourceId = typeof SourceId.Type

// Where the long video comes from. A File is copied into the source folder by the source stage.
export const SourceOrigin = Schema.Union([
  Schema.TaggedStruct("Url", { url: Schema.String }),
  Schema.TaggedStruct("File", { path: Schema.String })
])
export type SourceOrigin = typeof SourceOrigin.Type

export const SourceRights = Rights
export type SourceRights = Rights

// One long video. Its download, transcript, contact sheets and ad ranges are shared by every short made from it.
export const Source = Schema.Struct({
  id: SourceId,
  origin: SourceOrigin,
  // Filled in by the source stage from yt-dlp / file metadata.
  title: Schema.NullOr(Schema.String),
  channel: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  durationS: Schema.NullOr(Schema.Finite),
  rights: SourceRights,
  rightsNote: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString
})
export type Source = typeof Source.Type

export class SourceNotFound extends Schema.TaggedError<SourceNotFound>()("SourceNotFound", {
  id: SourceId
}) {}

// A video can't be deleted while shorts or video sets use it; delete those first. `message` says what uses it
// ("used by 2 shorts").
export class SourceInUse extends Schema.TaggedError<SourceInUse>()("SourceInUse", {
  id: SourceId,
  shorts: Schema.Int,
  sets: Schema.Int,
  message: Schema.String
}) {}

// A short draws from up to 10 videos, V1…V10.
export const MAX_SHORT_SOURCES = 10

// Which of a short's videos a clip comes from: its position in the short's videos (V1 = 0), not its id, so it
// stays short for agents and stable within the short. Every clip field of this type is optional and means V1
// when absent, so a single-video short's plans are written exactly as before.
export const SourceIndex = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_SHORT_SOURCES - 1 }))
export type SourceIndex = typeof SourceIndex.Type

// A group of videos you want shorts from, with its own story and proposals across them.
export const SourceSetId = Schema.String.pipe(Schema.brand("SourceSetId"))
export type SourceSetId = typeof SourceSetId.Type

// A video set takes 2 to 10 videos.
export const MIN_SET_SOURCES = 2

export class VideoSetNotFound extends Schema.TaggedError<VideoSetNotFound>()("VideoSetNotFound", {
  id: SourceSetId
}) {}

export class SourcesRpcs extends RpcGroup.make(
  Rpc.make("CreateSource", {
    payload: { origin: SourceOrigin, rights: SourceRights, rightsNote: Schema.NullOr(Schema.String) },
    success: Source
  }),
  Rpc.make("ListSources", { success: Schema.Array(Source) }),
  Rpc.make("GetSource", { payload: { id: SourceId }, success: Source, error: SourceNotFound }),
  Rpc.make("SetSourceRights", {
    payload: { id: SourceId, rights: SourceRights, rightsNote: Schema.NullOr(Schema.String) },
    success: Source,
    error: SourceNotFound
  }),
  // Names a video yourself, e.g. a local file: its title, and the channel credited when the footage isn't
  // yours ("Video: <channel>"). Null clears one.
  Rpc.make("SetSourceDetails", {
    payload: { id: SourceId, title: Schema.NullOr(Schema.String), channel: Schema.NullOr(Schema.String) },
    success: Source,
    error: SourceNotFound
  }),
  // Deletes the source and its folder; false when the source is unknown. Refused while shorts or video sets use
  // it ("used by 2 shorts").
  Rpc.make("DeleteSource", { payload: { id: SourceId }, success: Schema.Boolean, error: SourceInUse })
) {}
