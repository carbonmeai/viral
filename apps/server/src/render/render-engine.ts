import { NodeServices } from "@effect/platform-node"
import { type JobEvent, NarratedPlan } from "@viral/contracts"
import { Clock, Context, Effect, Exit, FileSystem, Layer, Path, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { ViralHome } from "../home/viral-home.ts"

// `code` comes from the script ("excluded-range", "anchor-mismatch", "ffmpeg", …) or is
// "spawn" / "exit" / "plan" when the failure happens around it.
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

// Every script reports failure the same way: one error line, then a non-zero exit.
const ErrorLine = Schema.fromJsonString(
  Schema.Struct({ type: Schema.Literal("error"), code: Schema.String, message: Schema.String })
)

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

// Runs the Python render scripts next to this file as child processes; each writes one JSON object
// per stdout line. Interrupting the effect closes the scope, which signals the whole process group
// (uv -> python -> ffmpeg).
export class RenderEngine extends Context.Service<RenderEngine, {
  renderProbe(seconds: number, emit: Emit): Effect.Effect<string, RenderError>
  // Writes the plan to `<workDir>/narrated.json` (its relative paths resolve against workDir) and
  // renders it to `out`, plus a sibling .srt.
  renderNarrated(plan: NarratedPlan, workDir: string, out: string, emit: Emit): Effect.Effect<NarratedRender, RenderError>
}>()("@viral/server/render/render-engine/RenderEngine") {
  static readonly layer = Layer.effect(
    RenderEngine,
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const home = yield* ViralHome
      const script = (name: string) => path.join(import.meta.dirname, name)

      // Spawns a uv script and passes each decoded stdout line to `onLine`, which may return the
      // result. An error line, a non-zero exit, or no result all become a RenderError.
      const runScript = Effect.fn("RenderEngine.runScript")(function*<A, R>(
        args: ReadonlyArray<string>,
        decodeLine: (raw: string) => Effect.Effect<A, Schema.SchemaError>,
        onLine: (line: A) => Effect.Effect<R | undefined>
      ) {
        const handle = yield* spawner.spawn(ChildProcess.make("uv", ["run", "--script", ...args])).pipe(
          Effect.mapError((cause) => new RenderError({ code: "spawn", message: cause.message }))
        )
        yield* Effect.logInfo("render started", { pid: handle.pid, script: args[0] })

        let result: R | undefined
        let failure: RenderError | undefined
        const handleLine = Effect.fnUntraced(function*(raw: string) {
          const error = yield* Effect.exit(Schema.decodeEffect(ErrorLine)(raw))
          if (Exit.isSuccess(error)) {
            failure = new RenderError({ code: error.value.code, message: error.value.message })
            return
          }
          const line = yield* decodeLine(raw)
          const value = yield* onLine(line)
          if (value !== undefined) result = value
        })

        yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.mapError((cause) => new RenderError({ code: "spawn", message: cause.message })),
          Stream.runForEach((raw) =>
            handleLine(raw).pipe(
              Effect.catchTag("SchemaError", () => Effect.logWarning("unparsed render line", { line: raw }))
            )
          )
        )

        const exitCode = yield* handle.exitCode.pipe(
          Effect.mapError((cause) => new RenderError({ code: "exit", message: cause.message }))
        )
        if (failure !== undefined) return yield* failure
        if (exitCode !== ChildProcessSpawner.ExitCode(0) || result === undefined) {
          return yield* new RenderError({ code: "exit", message: `render exited with code ${exitCode}` })
        }
        return result
      }, Effect.scoped)

      const renderProbe = Effect.fn("RenderEngine.renderProbe")(function*(seconds: number, emit: Emit) {
        const out = path.join(home.renders, `probe-${yield* Clock.currentTimeMillis}.mp4`)
        return yield* runScript(
          [script("render-probe.py"), "--seconds", String(seconds), "--out", out],
          Schema.decodeEffect(ProbeLine),
          (line) =>
            line.type === "done"
              ? Effect.succeed(line.output)
              : emit({ _tag: "Progress", stage: "render", pct: line.pct }).pipe(Effect.as(undefined))
        )
      })

      const renderNarrated = Effect.fn("RenderEngine.renderNarrated")(
        function*(plan: NarratedPlan, workDir: string, out: string, emit: Emit) {
          const planFile = path.join(workDir, "narrated.json")
          yield* Schema.encodeEffect(PlanJson)(plan).pipe(
            Effect.flatMap((encoded) => fs.writeFileString(planFile, encoded)),
            Effect.mapError((error) => new RenderError({ code: "plan", message: error.message }))
          )
          return yield* runScript(
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
          )
        }
      )

      return RenderEngine.of({ renderProbe, renderNarrated })
    })
  ).pipe(Layer.provide([NodeServices.layer, ViralHome.layer]))
}
