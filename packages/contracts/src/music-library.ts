import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export const MusicTrackId = Schema.String.pipe(Schema.brand("MusicTrackId"))
export type MusicTrackId = typeof MusicTrackId.Type

// A track you supplied, copied into ~/.viral/music/. BPM and drop are filled in by analysis.
export const MusicTrack = Schema.Struct({
  id: MusicTrackId,
  title: Schema.String,
  // relative to ~/.viral/music/
  path: Schema.String,
  durationS: Schema.NullOr(Schema.Finite),
  bpm: Schema.NullOr(Schema.Finite),
  dropS: Schema.NullOr(Schema.Finite),
  analyzedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  createdAt: Schema.DateTimeUtcFromString
})
export type MusicTrack = typeof MusicTrack.Type

export class MusicTrackNotFound extends Schema.TaggedError<MusicTrackNotFound>()("MusicTrackNotFound", {
  id: MusicTrackId
}) {}

export class MusicFileUnreadable extends Schema.TaggedError<MusicFileUnreadable>()("MusicFileUnreadable", {
  file: Schema.String,
  message: Schema.String
}) {}

export class MusicLibraryRpcs extends RpcGroup.make(
  Rpc.make("AddMusicTrack", {
    // `file` is an absolute path on the server's machine; the file is copied into the library.
    payload: { file: Schema.String, title: Schema.NullOr(Schema.String) },
    success: MusicTrack,
    error: MusicFileUnreadable
  }),
  Rpc.make("ListMusicTracks", { success: Schema.Array(MusicTrack) }),
  Rpc.make("GetMusicTrack", { payload: { id: MusicTrackId }, success: MusicTrack, error: MusicTrackNotFound }),
  // Removes the track and its file; shorts that used it keep going without music. False when unknown.
  Rpc.make("RemoveMusicTrack", { payload: { id: MusicTrackId }, success: Schema.Boolean })
) {}
