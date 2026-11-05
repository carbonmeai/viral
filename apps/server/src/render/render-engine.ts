import { NodeServices } from "@effect/platform-node"
import type { JobEvent } from "@viral/contracts"
import { Clock, Config, Context, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

export class RenderError extends Schema.TaggedError<RenderError>()("RenderError", {
  message: Schema.String
}) {}

type Emit = (event: JobEvent) => Effect.Effect<void>

const ProbeLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), pct: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("done"), output: Schema.String })
]))

// Runs the render script next to this file as a child process. Interrupting the
// effect closes the scope, which signals the whole process group (uv -> python -> ffmpeg).
export class RenderEngine extends Context.Service<RenderEngine, {
  renderProbe(seconds: number, emit: Emit): Effect.Effect<string, RenderError>
}>()("@viral/server/render/render-engine/RenderEngine") {
  static readonly layer = Layer.effect(
    RenderEngine,
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const home = yield* Config.String("HOME").pipe(Effect.orDie)
      const rendersDir = path.join(home, ".viral", "renders")
      yield* fs.makeDirectory(rendersDir, { recursive: true }).pipe(Effect.orDie)
      const probeScript = path.join(import.meta.dirname, "render-probe.py")

      const renderProbe = Effect.fn("RenderEngine.renderProbe")(function*(seconds: number, emit: Emit) {
        const out = path.join(rendersDir, `probe-${yield* Clock.currentTimeMillis}.mp4`)
        const handle = yield* spawner.spawn(
          ChildProcess.make("uv", ["run", "--script", probeScript, "--seconds", String(seconds), "--out", out])
        ).pipe(Effect.mapError((cause) => new RenderError({ message: cause.message })))

        yield* Effect.logInfo("render started", { pid: handle.pid })

        let output: string | undefined
        yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.mapError((cause) => new RenderError({ message: cause.message })),
          Stream.runForEach((line) =>
            Schema.decodeEffect(ProbeLine)(line).pipe(
              Effect.flatMap((msg) => {
                if (msg.type === "done") {
                  output = msg.output
                  return Effect.void
                }
                return emit({ _tag: "Progress", stage: "render", pct: msg.pct })
              }),
              Effect.catch(() => Effect.logWarning("unparsed render line", { line }))
            )
          )
        )

        const exitCode = yield* handle.exitCode.pipe(
          Effect.mapError((cause) => new RenderError({ message: cause.message }))
        )
        if (exitCode !== ChildProcessSpawner.ExitCode(0) || output === undefined) {
          return yield* new RenderError({ message: `render exited with code ${exitCode}` })
        }
        return output
      }, Effect.scoped)

      return RenderEngine.of({ renderProbe })
    })
  ).pipe(Layer.provide(NodeServices.layer))
}
