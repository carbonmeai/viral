import type { SourceId } from "@viral/contracts"
import { Context, Effect, Layer } from "effect"
import { AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { checkAds } from "./ad-rules.ts"
import { adsTask } from "./ads-task.ts"


const sourceOf = (ctx: StageContext): SourceId => {
  if (ctx.owner._tag !== "Source") throw new Error("the ads stage runs on a source")
  return ctx.owner.id
}

// Finds sponsor reads, ads, intros and end screens so later stages keep them out of every short.
export class AdsStage extends Context.Service<AdsStage, {
  readonly stage: StageDefinition
}>()("@viral/server/ads/ads-stage/AdsStage") {
  static readonly layer = Layer.effect(
    AdsStage,
    Effect.gen(function*() {
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const transcripts = yield* Transcripts
      const agent = yield* AgentSession
      const fail = (code: string, message: string) => new StageFailure({ stage: "ads", code, message })

      const run = Effect.fn("AdsStage.run")(function*(ctx: StageContext) {
        const id = sourceOf(ctx)
        const source = yield* sources.get(id).pipe(Effect.mapError(() => fail("not-found", `no source ${id}`)))
        const transcript = yield* transcripts.forSource(id).pipe(Effect.mapError(() => fail("not-ready", "no transcript yet")))
        const duration = source.durationS ?? transcript.segments.at(-1)?.end ?? 0
        const ranges = yield* runChecked(agent, ctx, adsTask({
          title: source.title,
          durationS: duration,
          transcript: transcripts.timedText(transcript)
        }), (proposed) => Effect.succeed(checkAds(proposed, duration))).pipe(Effect.mapError((e) => fail(e.code, e.message)))
        const slot = yield* artifacts.allocate(ctx.owner, "ad-ranges")
        yield* artifacts.record(slot, { data: ranges, path: null, stageRunId: ctx.stageRunId })
      })

      return AdsStage.of({ stage: { name: "ads", artifact: "ad-ranges", gate: null, run } })
    })
  ).pipe(Layer.provide([Sources.layer, Artifacts.layer, Transcripts.layer]))
}
