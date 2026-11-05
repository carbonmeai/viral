import { NodeServices } from "@effect/platform-node"
import { Context, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

// `code` comes from the script's own error line ("excluded-range", "ffmpeg", …), or is "spawn" / "exit"
// when the failure happens around it.
export class ScriptError extends Schema.TaggedError<ScriptError>()("ScriptError", {
  code: Schema.String,
  message: Schema.String
}) {}

// Every script reports failure the same way: one error line on stdout, then a non-zero exit.
const ErrorLine = Schema.fromJsonString(
  Schema.Struct({ type: Schema.Literal("error"), code: Schema.String, message: Schema.String })
)

const STDERR_TAIL = 4_000

// Runs the uv (PEP 723) Python scripts that live next to the domains using them. Each script writes one
// JSON object per stdout line; stderr is drained so a chatty tool (ffmpeg, tqdm) can never fill the pipe
// and stall the script, and its tail is attached to failures. Interrupting the run closes the scope,
// which signals the whole process group (uv -> python -> ffmpeg).
export class ScriptRunner extends Context.Service<ScriptRunner, {
  run<A, R>(
    args: ReadonlyArray<string>,
    decodeLine: (raw: string) => Effect.Effect<A, Schema.SchemaError>,
    // returns the script's result when the line carries it
    onLine: (line: A) => Effect.Effect<R | undefined>
  ): Effect.Effect<R, ScriptError>
}>()("@viral/server/script-runner/script-runner/ScriptRunner") {
  static readonly layer = Layer.effect(
    ScriptRunner,
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const run = Effect.fn("ScriptRunner.run")(function*<A, R>(
        args: ReadonlyArray<string>,
        decodeLine: (raw: string) => Effect.Effect<A, Schema.SchemaError>,
        onLine: (line: A) => Effect.Effect<R | undefined>
      ) {
        const handle = yield* spawner.spawn(ChildProcess.make("uv", ["run", "--script", ...args])).pipe(
          Effect.mapError((cause) => new ScriptError({ code: "spawn", message: cause.message }))
        )
        yield* Effect.logInfo("script started", { pid: handle.pid, script: args[0] })

        let stderr = ""
        const drainStderr = yield* handle.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) => Effect.sync(() => void (stderr = (stderr + chunk).slice(-STDERR_TAIL)))),
          Effect.ignore,
          Effect.forkScoped
        )

        let result: R | undefined
        let failure: ScriptError | undefined
        const handleLine = Effect.fnUntraced(function*(raw: string) {
          const error = yield* Effect.exit(Schema.decodeEffect(ErrorLine)(raw))
          if (Exit.isSuccess(error)) {
            failure = new ScriptError({ code: error.value.code, message: error.value.message })
            return
          }
          const value = yield* onLine(yield* decodeLine(raw))
          if (value !== undefined) result = value
        })

        yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.mapError((cause) => new ScriptError({ code: "spawn", message: cause.message })),
          Stream.runForEach((raw) =>
            handleLine(raw).pipe(
              Effect.catchTag("SchemaError", () => Effect.logWarning("unparsed script line", { line: raw }))
            )
          )
        )

        const exitCode = yield* handle.exitCode.pipe(
          Effect.mapError((cause) => new ScriptError({ code: "exit", message: cause.message }))
        )
        yield* Fiber.join(drainStderr)
        if (failure !== undefined) return yield* failure
        if (exitCode !== ChildProcessSpawner.ExitCode(0) || result === undefined) {
          return yield* new ScriptError({
            code: "exit",
            message: `${args[0]} exited with code ${exitCode}${stderr === "" ? "" : `\n${stderr.trim()}`}`
          })
        }
        return result
      }, Effect.scoped)

      return ScriptRunner.of({ run })
    })
  ).pipe(Layer.provide(NodeServices.layer))
}
