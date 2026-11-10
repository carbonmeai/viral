import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Rights } from "./rights.ts"

export const SourceId = Schema.String.pipe(Schema.brand("SourceId"))
export type SourceId = typeof SourceId.Type

// Where the long video comes from. A File is copied into the source folder by the source stage. A link with `scan`
// (videos found by research) is downloaded small, at 480p, for reading; a short then fetches only the seconds it
// uses in 1080p (SourcePiece). Absent = the whole video at up to 1080p, as before.
export const SourceOrigin = Schema.Union([
  Schema.TaggedStruct("Url", { url: Schema.String, scan: Schema.optionalKey(Schema.Boolean) }),
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

// A stretch of a scanned video fetched in full quality for a short: its file (absolute) and where it sits in the
// video, in seconds. Renderers read a clip from the piece that covers it, at (clip start − piece start).
export const SourcePiece = Schema.Struct({ path: Schema.String, start: Schema.Finite, end: Schema.Finite })
export type SourcePiece = typeof SourcePiece.Type

// A render plan's pieces, by the video's index in the plan as a string ("0" = V1), like `exclude_by_source`. A clip
// no piece covers plays from the video itself (the 480p scan).
export const PiecesBySource = Schema.Record(Schema.String, Schema.Array(SourcePiece))
export type PiecesBySource = typeof PiecesBySource.Type

// A short draws from up to 10 videos, V1…V10.
export const MAX_SHORT_SOURCES = 10

// Which of a short's videos a clip comes from: its position in the short's videos (V1 = 0), not its id, so it
// stays short for agents and stable within the short. Every clip field of this type is optional and means V1
// when absent, so a single-video short's plans are written exactly as before.
export const SourceIndex = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_SHORT_SOURCES - 1 }))
export type SourceIndex = typeof SourceIndex.Type

// How agents number a short's or a set's videos, matching their V labels: V1 = 1. The server converts to a
// SourceIndex (V1 = 0) when it checks what an agent sent.
export const VideoNumber = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_SHORT_SOURCES }))

// A group of videos you want shorts from, with its own story and proposals across them.
export const SourceSetId = Schema.String.pipe(Schema.brand("SourceSetId"))
export type SourceSetId = typeof SourceSetId.Type

// A video set takes 2 to 10 videos.
export const MIN_SET_SOURCES = 2

export class VideoSetNotFound extends Schema.TaggedError<VideoSetNotFound>()("VideoSetNotFound", {
  id: SourceSetId
}) {}

// What a pasted link is, read before anything downloads: its title, channel and length, and (for a YouTube link) its
// thumbnail saved in the Viral home (a path relative to it, served under /media). `live` is true for a live stream.
export const VideoLinkDetails = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  channel: Schema.NullOr(Schema.String),
  durationS: Schema.NullOr(Schema.Finite),
  thumbnail: Schema.NullOr(Schema.String),
  live: Schema.Boolean
})
export type VideoLinkDetails = typeof VideoLinkDetails.Type

// A link that couldn't be read (removed, private, blocked, not a video), in plain words.
export class VideoLinkLookupFailed extends Schema.TaggedError<VideoLinkLookupFailed>()("VideoLinkLookupFailed", {
  message: Schema.String
}) {}

export class SourcesRpcs extends RpcGroup.make(
  Rpc.make("CreateSource", {
    payload: { origin: SourceOrigin, rights: SourceRights, rightsNote: Schema.NullOr(Schema.String) },
    success: Source
  }),
  Rpc.make("ListSources", { success: Schema.Array(Source) }),
  // Reads a link's title, channel, length and thumbnail with yt-dlp, so Home can show what you pasted before you
  // start. Nothing is downloaded and no video is added.
  Rpc.make("LookupVideoLink", { payload: { link: Schema.String }, success: VideoLinkDetails, error: VideoLinkLookupFailed }),
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
