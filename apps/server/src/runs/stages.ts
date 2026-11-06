import type { Artifact, ArtifactKind, RunId, RunOwner, StageName, StageRunId } from "@viral/contracts"
import { Context, Effect, Option, Schema } from "effect"
import type { StageCost } from "./run-store.ts"

// A stage failed in a way the run should report. `code` is the stage's own ("not-ready", "ffmpeg", …).
export class StageFailure extends Schema.TaggedError<StageFailure>()("StageFailure", {
  stage: Schema.String,
  code: Schema.String,
  message: Schema.String
}) {}

// What a stage gets while it runs.
export interface StageContext {
  readonly owner: RunOwner
  readonly runId: RunId
  readonly stageRunId: StageRunId
  readonly attempt: number
  // your note when the previous attempt was rejected at its gate
  readonly note: string | null
  // the previous attempt's agent session, so a rejected agent stage continues its conversation with your note
  readonly resumeSession: string | null
  recordSession(sessionId: string): Effect.Effect<void>
  progress(pct: number | null, message?: string): Effect.Effect<void>
  recordCost(cost: StageCost): Effect.Effect<void>
}

// One step of a run. It produces one artifact (recorded with `ctx.stageRunId`); a stage with a `gate`
// then waits for approval before the run moves on.
export interface StageDefinition {
  readonly name: StageName
  readonly artifact: ArtifactKind
  // the approval question, or null when the stage needs no approval
  readonly gate: string | null
  run(ctx: StageContext): Effect.Effect<void, StageFailure>
  // Records your edited version of the artifact as a new version (gated stages only).
  applyEdit?(ctx: StageContext, artifact: unknown): Effect.Effect<void, StageFailure>
  // What the gate shows you: usually the artifact itself.
  gatePayload?(artifact: Artifact): unknown
}

// The stages of a run, in order: the source run's for a source, and the project's approach decides a short's.
export class StageRegistry extends Context.Service<StageRegistry, {
  stagesFor(owner: RunOwner): Effect.Effect<ReadonlyArray<StageDefinition>, StageFailure>
}>()("@viral/server/runs/stages/StageRegistry") {}

// Looks a stage up by name, for --from.
export const findStage = (stages: ReadonlyArray<StageDefinition>, name: StageName) =>
  Option.fromNullishOr(stages.findIndex((stage) => stage.name === name)).pipe(Option.filter((i) => i >= 0))
