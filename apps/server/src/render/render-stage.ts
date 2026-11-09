import { NodeServices } from "@effect/platform-node"
import { type Artifact, CutRenderPlan, type GatePayload, NarratedPlan, RankingRenderPlan, type RenderChecks, RenderedShort } from "@viral/contracts"
import { Context, Effect, Layer, Option, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Artifacts } from "../artifacts/artifacts.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { RenderEngine } from "./render-engine.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "render", code, message })

// columns of the check sheet: one row per ten seconds of the short
const CHECK_COLUMNS = 10

// Renders the assembled plan to an mp4 + srt and draws a check sheet (a frame per second) for the gate. The
// render follows its plan, so rejecting it sends your note back to the stage that planned it (shots for a
// narrated short, sections for a cut-down one), and everything after runs again.
export class RenderStage extends Context.Service<RenderStage, {
  readonly narrated: StageDefinition
  readonly cut: StageDefinition
  readonly ranking: StageDefinition
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

      // Records a finished render: its check sheet, its captions, and the render itself.
      const finish = Effect.fn("RenderStage.finish")(function*(
        ctx: StageContext,
        slot: { readonly dir: string; readonly relDir: string; readonly owner: Artifact["owner"]; readonly kind: Artifact["kind"]; readonly version: number },
        rendered: {
          readonly output: string
          readonly captions: string
          readonly durationS: number
          readonly parts: number
          readonly checks?: RenderChecks
        }
      ) {
        yield* ctx.progress(95, "drawing the check sheet")
        const sheet = yield* checkSheet(rendered.output, rendered.durationS, path.join(slot.dir, "check.png"))
        const result: RenderedShort = {
          video: rendered.output,
          captions: rendered.captions,
          durationS: rendered.durationS,
          shots: rendered.parts,
          checkSheet: sheet,
          ...(rendered.checks === undefined ? {} : { checks: rendered.checks })
        }
        const captions = yield* artifacts.allocate(ctx.owner, "captions")
        // the srt is written next to the mp4, in the render's folder
        yield* artifacts.record(captions, {
          data: null,
          path: path.join(slot.relDir, path.basename(rendered.captions)),
          stageRunId: ctx.stageRunId
        })
        yield* artifacts.record(slot, { data: result, path: path.join(slot.relDir, path.basename(rendered.output)), stageRunId: ctx.stageRunId })
      })

      const runNarrated = Effect.fn("RenderStage.narrated")(function*(ctx: StageContext) {
        const planArtifact = yield* artifacts.latest(ctx.owner, "narrated-plan")
        const plan = yield* Effect.fromOption(Option.flatMap(planArtifact, (a) => Schema.decodeUnknownOption(NarratedPlan)(a.data))).pipe(
          Effect.mapError(() => fail("not-ready", "the short hasn't been assembled"))
        )
        const slot = yield* artifacts.allocate(ctx.owner, "render")
        const rendered = yield* engine.renderNarrated(plan, slot.dir, path.join(slot.dir, `${plan.slug}.mp4`), ctx.progress).pipe(
          Effect.mapError((e) => fail(e.code, e.message))
        )
        yield* finish(ctx, slot, { ...rendered, parts: rendered.shots })
      })

      const runCut = Effect.fn("RenderStage.cut")(function*(ctx: StageContext) {
        const planArtifact = yield* artifacts.latest(ctx.owner, "cut-render-plan")
        const plan = yield* Effect.fromOption(Option.flatMap(planArtifact, (a) => Schema.decodeUnknownOption(CutRenderPlan)(a.data))).pipe(
          Effect.mapError(() => fail("not-ready", "the short hasn't been assembled"))
        )
        const slot = yield* artifacts.allocate(ctx.owner, "render")
        const rendered = yield* engine.renderCut(plan, slot.dir, path.join(slot.dir, `${plan.slug}.mp4`), ctx.progress).pipe(
          Effect.mapError((e) => fail(e.code, e.message))
        )
        yield* finish(ctx, slot, { ...rendered, parts: rendered.sections })
      })

      // A ranking's mp4 is checked as it's rendered: black stretches, every shot's first and last frame, loudness.
      const runRanking = Effect.fn("RenderStage.ranking")(function*(ctx: StageContext) {
        const planArtifact = yield* artifacts.latest(ctx.owner, "ranking-render-plan")
        const plan = yield* Effect.fromOption(Option.flatMap(planArtifact, (a) => Schema.decodeUnknownOption(RankingRenderPlan)(a.data))).pipe(
          Effect.mapError(() => fail("not-ready", "the short hasn't been assembled"))
        )
        const slot = yield* artifacts.allocate(ctx.owner, "render")
        const rendered = yield* engine.renderRanking(plan, slot.dir, path.join(slot.dir, `${plan.slug}.mp4`), ctx.progress).pipe(
          Effect.mapError((e) => fail(e.code, e.message))
        )
        const { black, lufs } = rendered.checks
        if (black.length > 0) {
          yield* ctx.progress(null, `black frames at ${black.map(([s, e]) => `${s.toFixed(1)}–${e.toFixed(1)}s`).join(", ")}: look before approving`)
        }
        if (lufs !== null && Math.abs(lufs - (plan.lufs ?? -14)) > 1.5) {
          yield* ctx.progress(null, `loudness measured ${lufs.toFixed(1)} LUFS (aimed for ${(plan.lufs ?? -14).toFixed(0)})`)
        }
        yield* finish(ctx, slot, { ...rendered, parts: rendered.shots })
      })

      const gatePayload = (artifact: Artifact): GatePayload =>
        Option.match(Schema.decodeUnknownOption(RenderedShort)(artifact.data), {
          onNone: () => ({ _tag: "ArtifactGate", artifact }),
          onSome: (render) => ({ _tag: "RenderGate", render })
        })
      const base = { name: "render", artifact: "render", gate: "Approve the render?", gatePayload } as const

      return RenderStage.of({
        narrated: { ...base, rejectTo: "shots", run: runNarrated },
        cut: { ...base, rejectTo: "sections", run: runCut },
        ranking: { ...base, rejectTo: "moments", run: runRanking }
      })
    })
  ).pipe(Layer.provide([Artifacts.layer, RenderEngine.layer, NodeServices.layer]))
}
