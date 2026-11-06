import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { ReferenceVideoId } from "./references.ts"
import { Rights } from "./rights.ts"

export const MusicTrackId = Schema.String.pipe(Schema.brand("MusicTrackId"))
export type MusicTrackId = typeof MusicTrackId.Type

export const MusicTrackOrigin = Schema.Union([
  Schema.TaggedStruct("Upload", { file: Schema.String }),
  // downloaded from a video link (e.g. the TikTok sound itself)
  Schema.TaggedStruct("Url", { url: Schema.String }),
  // ships with Viral; `plan` is the composition plan it was generated from
  Schema.TaggedStruct("Bundled", { plan: Schema.Unknown })
])
export type MusicTrackOrigin = typeof MusicTrackOrigin.Type

// Who set a track's tempo and drop: analysis, or you (a value you set is never overwritten by analysis).
export const BeatSource = Schema.Literals(["analysis", "manual"])
export type BeatSource = typeof BeatSource.Type

// A track in your library, copied into ~/.viral/music/. BPM, drop and loudness are filled in by analysis.
export const MusicTrack = Schema.Struct({
  id: MusicTrackId,
  title: Schema.String,
  // relative to ~/.viral/music/
  path: Schema.String,
  origin: MusicTrackOrigin,
  // a short using an `unconfirmed` track is warned about Content ID claims
  rights: Rights,
  referenceId: Schema.NullOr(ReferenceVideoId),
  durationS: Schema.NullOr(Schema.Finite),
  bpm: Schema.NullOr(Schema.Finite),
  dropS: Schema.NullOr(Schema.Finite),
  beatSource: Schema.NullOr(BeatSource),
  loudnessLufs: Schema.NullOr(Schema.Finite),
  analyzedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  createdAt: Schema.DateTimeUtcFromString
})
export type MusicTrack = typeof MusicTrack.Type

export class MusicTrackNotFound extends Schema.TaggedError<MusicTrackNotFound>()("MusicTrackNotFound", {
  id: MusicTrackId
}) {}

// `code`: the analysis script's ("decode", "too-short", …), or "spawn"/"exit" from running it.
export class MusicAnalysisError extends Schema.TaggedError<MusicAnalysisError>()("MusicAnalysisError", {
  code: Schema.String,
  message: Schema.String
}) {}

export class MusicFileUnreadable extends Schema.TaggedError<MusicFileUnreadable>()("MusicFileUnreadable", {
  file: Schema.String,
  message: Schema.String
}) {}

export class MusicLibraryRpcs extends RpcGroup.make(
  Rpc.make("AddMusicTrack", {
    // `file` is an absolute path on the server's machine; the file is copied into the library.
    payload: { file: Schema.String, title: Schema.NullOr(Schema.String), rights: Rights },
    success: MusicTrack,
    error: MusicFileUnreadable
  }),
  Rpc.make("SetMusicTrackRights", {
    payload: { id: MusicTrackId, rights: Rights },
    success: MusicTrack,
    error: MusicTrackNotFound
  }),
  // Records a track's tempo and where its drop hits (seconds into the file), so a short's music can drop on
  // the payoff. Analysis fills these in when a track is added; a value you set here is never overwritten.
  Rpc.make("SetMusicTrackBeat", {
    payload: { id: MusicTrackId, bpm: Schema.Finite, dropS: Schema.Finite },
    success: MusicTrack,
    error: MusicTrackNotFound
  }),
  // Measures a track's tempo, drop and loudness again (adding a track already does this in the background).
  Rpc.make("AnalyseMusicTrack", {
    payload: { id: MusicTrackId },
    success: MusicTrack,
    error: Schema.Union([MusicTrackNotFound, MusicAnalysisError])
  }),
  Rpc.make("ListMusicTracks", { success: Schema.Array(MusicTrack) }),
  Rpc.make("GetMusicTrack", { payload: { id: MusicTrackId }, success: MusicTrack, error: MusicTrackNotFound }),
  // Removes the track and its file; shorts that used it keep going without music. False when unknown.
  Rpc.make("RemoveMusicTrack", { payload: { id: MusicTrackId }, success: Schema.Boolean })
) {}
