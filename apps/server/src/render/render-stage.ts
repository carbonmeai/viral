import { NodeServices } from "@effect/platform-node"
import { type Artifact, NarratedPlan, RenderedShort } from "@viral/contracts"
import { Context, Effect, Layer, Option, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Artifacts } from "../artifacts/artifacts.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { RenderEngine } from "./render-engine.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "render", code, message })

// columns of the check sheet: one row per ten seconds of the short
const CHECK_COLUMNS = 10

// Renders the assembled plan to an mp4 + srt and draws a check sheet (a frame per second) for the gate. The
// render follows its plan, so rejecting it sends your note back to the shots stage, and everything after
// runs again.
export class RenderStage extends Context.Service<RenderStage, {
  readonly stage: StageDefinition
}>()("@viral/server/render/render-stage/RenderStage") {
  static readonly layer = Layer.effect(
    RenderStage,
    Effect.gen(function*() {
      const artifacts = yield* Artifacts
      const engine = yield* RenderEngine
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const path = yield* Path.Path

      const checkSheet = (video: string, seconds: number, out: string) =>
        spawner.exitCode(ChildProcess.make("ffmpeg", [
          "-y", "-loglevel", "error", "-i", video,
          "-vf", `fps=1,scale=180:-2,tile=${CHECK_COLUMNS}x${Math.max(1, Math.ceil(seconds / CHECK_COLUMNS))}`,
          "-frames:v", "1", out
        ])).pipe(
          Effect.map((code) => code === ChildProcessSpawner.ExitCode(0) ? out : null),
          Effect.orElseSucceed(() => null)
        )

      const run = Effect.fn("RenderStage.run")(function*(ctx: StageContext) {
        const planArtifact = yield* artifacts.latest(ctx.owner, "narrated-plan")
        const plan = yield* Effect.fromOption(Option.flatMap(planArtifact, (a) => Schema.decodeUnknownOption(NarratedPlan)(a.data))).pipe(
          Effect.mapError(() => fail("not-ready", "the short hasn't been assembled"))
        )
        const slot = yield* artifacts.allocate(ctx.owner, "render")
        const out = path.join(slot.dir, `${plan.slug}.mp4`)
        const rendered = yield* engine.renderNarrated(plan, slot.dir, out, ctx.progress).pipe(
          Effect.mapError((e) => fail(e.code, e.message))
        )
        yield* ctx.progress(95, "drawing the check sheet")
        const sheet = yield* checkSheet(rendered.output, rendered.durationS, path.join(slot.dir, "check.png"))
        const result: RenderedShort = {
          video: rendered.output,
          captions: rendered.captions,
          durationS: rendered.durationS,
          shots: rendered.shots,
          checkSheet: sheet
        }
        const captions = yield* artifacts.allocate(ctx.owner, "captions")
        // the srt is written next to the mp4, in the render's folder
        yield* artifacts.record(captions, {
          data: null,
          path: path.join(slot.relDir, path.basename(rendered.captions)),
          stageRunId: ctx.stageRunId
        })
        yield* artifacts.record(slot, { data: result, path: path.join(slot.relDir, `${plan.slug}.mp4`), stageRunId: ctx.stageRunId })
      })

      const stage: StageDefinition = {
        name: "render",
        artifact: "render",
        gate: "Approve the render?",
        rejectTo: "shots",
        run,
        gatePayload: (artifact: Artifact) => artifact.data
      }
      return RenderStage.of({ stage })
    })
  ).pipe(Layer.provide([Artifacts.layer, RenderEngine.layer, NodeServices.layer]))
}
