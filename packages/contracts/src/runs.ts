import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { GatePayload } from "./gates.ts"
import { ProjectId, ProjectNotFound } from "./projects.ts"
import { SourceId, SourceNotFound } from "./sources.ts"

export const RunId = Schema.String.pipe(Schema.brand("RunId"))
export type RunId = typeof RunId.Type
export const StageRunId = Schema.String.pipe(Schema.brand("StageRunId"))
export type StageRunId = typeof StageRunId.Type
export const RequestId = Schema.String.pipe(Schema.brand("RequestId"))
export type RequestId = typeof RequestId.Type

// Every stage of both runs, in pipeline order.
export const StageName = Schema.Literals([
  // source run
  "source",
  "transcribe",
  "contact-sheet",
  "ads",
  "story",
  // short run
  "script",
  "sections",
  "voice",
  "shots",
  "assemble",
  "render",
  "metadata"
])
export type StageName = typeof StageName.Type

// A source run works on the long video; a project run makes one short.
export const RunOwner = Schema.Union([
  Schema.TaggedStruct("Source", { id: SourceId }),
  Schema.TaggedStruct("Project", { id: ProjectId })
])
export type RunOwner = typeof RunOwner.Type

export const RunStatus = Schema.Literals(["running", "waiting", "completed", "failed", "cancelled", "interrupted"])
export type RunStatus = typeof RunStatus.Type

export const Run = Schema.Struct({
  id: RunId,
  owner: RunOwner,
  status: RunStatus,
  // set when the run was started or resumed from a given stage
  fromStage: Schema.NullOr(StageName),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.DateTimeUtcFromString,
  finishedAt: Schema.NullOr(Schema.DateTimeUtcFromString)
})
export type Run = typeof Run.Type

// reused = the stage's approved artifact already existed, so nothing ran
export const StageRunStatus = Schema.Literals([
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
  "reused"
])
export type StageRunStatus = typeof StageRunStatus.Type

export const StageRun = Schema.Struct({
  id: StageRunId,
  runId: RunId,
  stage: StageName,
  attempt: Schema.Int,
  status: StageRunStatus,
  model: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  inputTokens: Schema.NullOr(Schema.Int),
  outputTokens: Schema.NullOr(Schema.Int),
  costUsd: Schema.NullOr(Schema.Finite),
  ttsCharacters: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(Schema.Int),
  startedAt: Schema.DateTimeUtcFromString,
  finishedAt: Schema.NullOr(Schema.DateTimeUtcFromString)
})
export type StageRun = typeof StageRun.Type

// How you answer a gate: carry on, re-run the stage with a note, or continue with your own edited artifact.
export const GateResponse = Schema.Union([
  Schema.TaggedStruct("Approve", {}),
  Schema.TaggedStruct("Reject", { note: Schema.String }),
  Schema.TaggedStruct("Edit", { artifact: Schema.Unknown })
])
export type GateResponse = typeof GateResponse.Type

export const RequestStatus = Schema.Literals(["pending", "answered", "cancelled"])
export type RequestStatus = typeof RequestStatus.Type

// A gate (or, later, an input request) the run is waiting on.
export const RunRequest = Schema.Struct({
  id: RequestId,
  runId: RunId,
  stageRunId: StageRunId,
  stage: StageName,
  kind: Schema.Literals(["approval", "input"]),
  title: Schema.String,
  // what is being approved, shaped for the gate's stage
  payload: Schema.NullOr(GatePayload),
  status: RequestStatus,
  response: Schema.NullOr(GateResponse),
  createdAt: Schema.DateTimeUtcFromString,
  answeredAt: Schema.NullOr(Schema.DateTimeUtcFromString)
})
export type RunRequest = typeof RunRequest.Type

// Stage-level events, stored with a sequence number so a reconnecting client can catch up.
export const RunEvent = Schema.Union([
  Schema.TaggedStruct("RunStarted", { run: Run }),
  Schema.TaggedStruct("StageStarted", { stageRun: StageRun }),
  Schema.TaggedStruct("StageFinished", { stageRun: StageRun }),
  Schema.TaggedStruct("RequestRaised", { request: RunRequest }),
  Schema.TaggedStruct("RequestAnswered", { request: RunRequest }),
  Schema.TaggedStruct("RunFinished", { run: Run })
])
export type RunEvent = typeof RunEvent.Type

// What a subscriber receives: first a snapshot, then stored events (with their seq) and live progress.
export const RunUpdate = Schema.Union([
  Schema.TaggedStruct("Snapshot", {
    run: Run,
    stageRuns: Schema.Array(StageRun),
    pending: Schema.Array(RunRequest),
    lastSeq: Schema.Int
  }),
  Schema.TaggedStruct("Event", { seq: Schema.Int, event: RunEvent }),
  // live only, never stored
  // pct is null when a stage can't tell (an agent thinking), with a message instead
  Schema.TaggedStruct("Progress", {
    stage: StageName,
    pct: Schema.NullOr(Schema.Finite),
    message: Schema.NullOr(Schema.String)
  })
])
export type RunUpdate = typeof RunUpdate.Type

export class RunNotFound extends Schema.TaggedError<RunNotFound>()("RunNotFound", { id: RunId }) {}

export class RequestNotPending extends Schema.TaggedError<RequestNotPending>()("RequestNotPending", {
  id: RequestId
}) {}

export class RunsRpcs extends RpcGroup.make(
  Rpc.make("StartSourceRun", { payload: { sourceId: SourceId }, success: Run, error: SourceNotFound }),
  Rpc.make("StartProjectRun", {
    // `from` re-runs that stage and every one after it, as new artifact versions
    payload: { projectId: ProjectId, from: Schema.NullOr(StageName) },
    success: Run,
    error: ProjectNotFound
  }),
  Rpc.make("CancelRun", { payload: { runId: RunId }, success: Schema.Boolean }),
  // Starts a new run from the first stage without an approved artifact; finished work is never redone.
  Rpc.make("ResumeRun", { payload: { runId: RunId }, success: Run, error: RunNotFound }),
  Rpc.make("ListRuns", { payload: { owner: RunOwner }, success: Schema.Array(Run) }),
  Rpc.make("SubscribeRun", {
    payload: { runId: RunId, afterSeq: Schema.Int },
    success: RunUpdate,
    error: RunNotFound,
    stream: true
  }),
  Rpc.make("ListPendingRequests", { success: Schema.Array(RunRequest) }),
  Rpc.make("RespondToRequest", {
    payload: { requestId: RequestId, response: GateResponse },
    success: RunRequest,
    error: RequestNotPending
  })
) {}
