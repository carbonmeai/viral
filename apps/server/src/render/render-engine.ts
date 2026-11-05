import { NodeServices } from "@effect/platform-node"
import { type JobEvent, NarratedPlan } from "@viral/contracts"
import { Clock, Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { ViralHome } from "../home/viral-home.ts"
import { type ScriptError, ScriptRunner } from "../script-runner/script-runner.ts"

// `code` is the script's ("excluded-range", "anchor-mismatch", "ffmpeg", …), "spawn" / "exit" from the
// runner, or "plan" when the plan can't be written.
export class RenderError extends Schema.TaggedError<RenderError>()("RenderError", {
  code: Schema.String,
  message: Schema.String
}) {}

type Emit = (event: JobEvent) => Effect.Effect<void>

export interface NarratedRender {
  readonly output: string
  readonly captions: string
  readonly durationS: number
  readonly shots: number
}

const ProbeLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), pct: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("done"), output: Schema.String })
]))

const NarratedStep = Schema.Literals(["shots", "outro", "overlays", "encode"])
const NarratedLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), step: NarratedStep, done: Schema.Int, total: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("log"), message: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("done"),
    output: Schema.String,
    captions: Schema.String,
    duration_s: Schema.Finite,
    shots: Schema.Int,
    narration_s: Schema.Finite,
    outro_s: Schema.Finite
  })
]))

// Overall render % per step: cutting shots dominates; the final encode is one long ffmpeg pass.
const narratedPct = (step: typeof NarratedStep.Type, done: number, total: number) => {
  const fraction = total === 0 ? 1 : done / total
  switch (step) {
    case "shots":
      return 75 * fraction
    case "outro":
      return 75 + 5 * fraction
    case "overlays":
      return 82
    case "encode":
      return 85
  }
}

const PlanJson = Schema.fromJsonString(NarratedPlan)

// Runs the Python render scripts next to this file through the ScriptRunner.
export class RenderEngine extends Context.Service<RenderEngine, {
  renderProbe(seconds: number, emit: Emit): Effect.Effect<string, RenderError>
  // Writes the plan to `<workDir>/narrated.json` (its relative paths resolve against workDir) and
  // renders it to `out`, plus a sibling .srt.
  renderNarrated(plan: NarratedPlan, workDir: string, out: string, emit: Emit): Effect.Effect<NarratedRender, RenderError>
}>()("@viral/server/render/render-engine/RenderEngine") {
  static readonly layer = Layer.effect(
    RenderEngine,
    Effect.gen(function*() {
      const scripts = yield* ScriptRunner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const home = yield* ViralHome
      const script = (name: string) => path.join(import.meta.dirname, name)
      const toRenderError = Effect.mapError((error: ScriptError) => new RenderError({ code: error.code, message: error.message }))

      const renderProbe = Effect.fn("RenderEngine.renderProbe")(function*(seconds: number, emit: Emit) {
        const out = path.join(home.renders, `probe-${yield* Clock.currentTimeMillis}.mp4`)
        return yield* scripts.run(
          [script("render-probe.py"), "--seconds", String(seconds), "--out", out],
          Schema.decodeEffect(ProbeLine),
          (line) =>
            line.type === "done"
              ? Effect.succeed(line.output)
              : emit({ _tag: "Progress", stage: "render", pct: line.pct }).pipe(Effect.as(undefined))
        ).pipe(toRenderError)
      })

      const renderNarrated = Effect.fn("RenderEngine.renderNarrated")(
        function*(plan: NarratedPlan, workDir: string, out: string, emit: Emit) {
          const planFile = path.join(workDir, "narrated.json")
          yield* Schema.encodeEffect(PlanJson)(plan).pipe(
            Effect.flatMap((encoded) => fs.writeFileString(planFile, encoded)),
            Effect.mapError((error) => new RenderError({ code: "plan", message: error.message }))
          )
          return yield* scripts.run(
            [script("render-narrated.py"), planFile, "--out", out],
            Schema.decodeEffect(NarratedLine),
            (line): Effect.Effect<NarratedRender | undefined> => {
              switch (line.type) {
                case "progress":
                  return emit({ _tag: "Progress", stage: "render", pct: narratedPct(line.step, line.done, line.total) })
                    .pipe(Effect.as(undefined))
                case "log":
                  return Effect.logInfo(line.message).pipe(Effect.as(undefined))
                case "done":
                  return Effect.succeed({
                    output: line.output,
                    captions: line.captions,
                    durationS: line.duration_s,
                    shots: line.shots
                  })
              }
            }
          ).pipe(toRenderError)
        }
      )

      return RenderEngine.of({ renderProbe, renderNarrated })
    })
  ).pipe(Layer.provide([NodeServices.layer, ViralHome.layer, ScriptRunner.layer]))
}
