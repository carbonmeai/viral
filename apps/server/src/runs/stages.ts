import type { Artifact, ArtifactKind, GatePayload, RunId, RunOwner, StageName, StageRunId } from "@viral/contracts"
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
  // runs before the run's prerequisites (a research finds the set's videos before they can be read); the
  // prerequisites are worked out and fulfilled just before the first stage without this
  readonly beforePrerequisites?: boolean
  run(ctx: StageContext): Effect.Effect<void, StageFailure>
  // Records your edited version of the artifact as a new version (gated stages only).
  applyEdit?(ctx: StageContext, artifact: unknown): Effect.Effect<void, StageFailure>
  // What the gate shows you; without it, the artifact as stored.
  gatePayload?(artifact: Artifact): GatePayload
  // Where a rejection goes when this stage can't act on a note itself (the render follows its plan): that
  // earlier stage runs again with your note, and every stage after it follows.
  readonly rejectTo?: StageName
  // What happens once you approve the stage's artifact (or approve your edit of it), e.g. the thumbnail being
  // copied next to the published video. Runs before the stage counts as succeeded.
  approved?(ctx: StageContext): Effect.Effect<void, StageFailure>
}

// A run another run needs finished first: a video set's run needs each of its videos read, which is that video's own
// run up to and including `through`. `label` names it in problems ("V2 \"Title\"").
export interface Prerequisite {
  readonly owner: RunOwner
  readonly through: StageName
  readonly label: string
}

// The stages of a run, in order: the source run's for a source, the set story for a video set, and the project's
// approach decides a short's.
export class StageRegistry extends Context.Service<StageRegistry, {
  stagesFor(owner: RunOwner): Effect.Effect<ReadonlyArray<StageDefinition>, StageFailure>
  // the runs that must finish before this one's stages (none when absent)
  prerequisites?(owner: RunOwner): Effect.Effect<ReadonlyArray<Prerequisite>, StageFailure>
}>()("@viral/server/runs/stages/StageRegistry") {}

// Looks a stage up by name, for --from.
export const findStage = (stages: ReadonlyArray<StageDefinition>, name: StageName) =>
  Option.fromNullishOr(stages.findIndex((stage) => stage.name === name)).pipe(Option.filter((i) => i >= 0))
