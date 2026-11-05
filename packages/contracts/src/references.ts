import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export const ReferenceVideoId = Schema.String.pipe(Schema.brand("ReferenceVideoId"))
export type ReferenceVideoId = typeof ReferenceVideoId.Type

// A viral video kept to learn from: its cuts, caption timing and sound hits are analysed into patterns.
// Its audio is never reused in a short.
export const ReferenceVideo = Schema.Struct({
  id: ReferenceVideoId,
  url: Schema.String,
  platform: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  creator: Schema.NullOr(Schema.String),
  durationS: Schema.NullOr(Schema.Finite),
  notes: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString
})
export type ReferenceVideo = typeof ReferenceVideo.Type

export class ReferenceVideoNotFound extends Schema.TaggedError<ReferenceVideoNotFound>()("ReferenceVideoNotFound", {
  id: ReferenceVideoId
}) {}

export class ReferencesRpcs extends RpcGroup.make(
  Rpc.make("CreateReferenceVideo", {
    payload: { url: Schema.String, notes: Schema.NullOr(Schema.String) },
    success: ReferenceVideo
  }),
  Rpc.make("ListReferenceVideos", { success: Schema.Array(ReferenceVideo) }),
  Rpc.make("GetReferenceVideo", { payload: { id: ReferenceVideoId }, success: ReferenceVideo, error: ReferenceVideoNotFound }),
  // Deletes the reference and its analyses; tracks imported from it stay in the library. False when unknown.
  Rpc.make("DeleteReferenceVideo", { payload: { id: ReferenceVideoId }, success: Schema.Boolean })
) {}
