import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { JobEvent } from "./pipeline.ts"

export const SourceId = Schema.String.pipe(Schema.brand("SourceId"))
export type SourceId = typeof SourceId.Type

// Where the long video comes from. A File is copied into the source folder by the source stage.
export const SourceOrigin = Schema.Union([
  Schema.TaggedStruct("Url", { url: Schema.String }),
  Schema.TaggedStruct("File", { path: Schema.String })
])
export type SourceOrigin = typeof SourceOrigin.Type

export const SourceRights = Schema.Literals(["unconfirmed", "owned", "licensed"])
export type SourceRights = typeof SourceRights.Type

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

// Stages that work on the long video itself; their artifacts are shared by every short from it.
export const SourceStage = Schema.Literals(["source", "transcribe", "contact-sheet"])
export type SourceStage = typeof SourceStage.Type

export class SourceNotFound extends Schema.TaggedError<SourceNotFound>()("SourceNotFound", {
  id: SourceId
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
  // Runs one source-level stage and streams its events. A stage whose artifact already exists is
  // skipped unless `force`. Until the pipeline owns stage order, the caller runs them in order.
  Rpc.make("RunSourceStage", {
    payload: { id: SourceId, stage: SourceStage, force: Schema.Boolean },
    success: JobEvent,
    stream: true
  }),
  // Deletes the source, every short made from it, and their folders; false when the source is unknown.
  Rpc.make("DeleteSource", { payload: { id: SourceId }, success: Schema.Boolean })
) {}
