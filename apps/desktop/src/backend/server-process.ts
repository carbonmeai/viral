import { Clock, Context, Deferred, Duration, Effect, Layer, Schedule } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { type LaunchInput, restartDelayMs, serverLaunch } from "./server-launch.ts"

// A run that stays up this long counts as healthy, so the next crash starts the backoff again from 0.5s.
const HEALTHY_RUN = Duration.seconds(30)
// How long the server gets to shut down when the app quits before it's killed.
const GRACE = Duration.seconds(5)

// The Viral server as the desktop app runs it: started with the app, restarted with backoff if it exits,
// and stopped (SIGTERM, then SIGKILL after 5s) when the app quits. `ready` waits for GET /healthz.
export class ServerProcess extends Context.Service<ServerProcess, {
  readonly url: string
  readonly ready: Effect.Effect<void>
}>()("@viral/desktop/backend/server-process/ServerProcess") {
  static readonly layer = (input: LaunchInput) =>
    Layer.effect(
      ServerProcess,
      Effect.gen(function*() {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
        const launch = serverLaunch(input)
        const url = `http://127.0.0.1:${input.port}`
        const ready = yield* Deferred.make<void>()

        const runOnce = Effect.scoped(
          Effect.gen(function*() {
            const handle = yield* spawner.spawn(ChildProcess.make(launch.command, launch.args, {
              cwd: input.packaged ? input.resourcesPath : input.repoRoot,
              env: launch.env,
              extendEnv: true,
              stdout: "inherit",
              stderr: "inherit",
              forceKillAfter: GRACE
            }))
            return yield* handle.exitCode
          })
        )

        const supervise = Effect.gen(function*() {
          for (let attempt = 0;;) {
            const started = yield* Clock.currentTimeMillis
            const exit = yield* runOnce.pipe(Effect.result)
            yield* Effect.logWarning("the Viral server stopped; restarting", { exit: String(exit) })
            const ran = (yield* Clock.currentTimeMillis) - started
            attempt = ran > Duration.toMillis(HEALTHY_RUN) ? 0 : attempt + 1
            yield* Effect.sleep(Duration.millis(restartDelayMs(attempt)))
          }
        })

        const waitHealthy = http.get(`${url}/healthz`).pipe(
          Effect.retry(Schedule.spaced(Duration.millis(200))),
          Effect.andThen(Deferred.succeed(ready, undefined))
        )

        yield* Effect.forkScoped(supervise)
        yield* Effect.forkScoped(waitHealthy)
        return ServerProcess.of({ url, ready: Deferred.await(ready) })
      })
    ).pipe(Layer.provide(FetchHttpClient.layer))
}
