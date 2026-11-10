import { Deferred, Effect, Option, Schema, Stream } from "effect"
import { SecureRandom } from "effect/crypto"
import { FetchHttpClient } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { createServer } from "node:net"
import { AgentError } from "@viral/provider-core"
import { makeOpencodeApi, type OpencodeApi } from "./opencode-api.ts"

// The oldest OpenCode whose server API Viral's client speaks: OpenCode 2's `/api` (1.x's API is gone in 2, and 2's
// isn't in 1.x, so there's no supporting both).
export const MIN_OPENCODE_VERSION = "2.2.6"

const STARTUP_TIMEOUT = "20 seconds"
const OUTPUT_TAIL = 2_000

export const parseVersion = (text: string) => {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/)
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])] as const
}

// true when `version` is at least `min` (both "x.y.z")
export const atLeast = (version: string, min: string) => {
  const a = parseVersion(version)
  const b = parseVersion(min)
  if (a === null || b === null) return false
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return true
}

export const updateHint = "Update to OpenCode 2 with `opencode upgrade` (or the package manager you installed it with)."

// `opencode serve --port=0` falls back to its fixed default port, so Viral picks a free one itself
const freePort = Effect.callback<number, AgentError>((resume) => {
  const server = createServer()
  server.once("error", (cause) => resume(Effect.fail(new AgentError({ code: "session", message: `no free port for OpenCode: ${cause.message}` }))))
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    const port = typeof address === "object" && address !== null ? address.port : 0
    server.close(() => resume(Effect.succeed(port)))
  })
})

export interface OpencodeServer {
  readonly url: string
  readonly api: OpencodeApi
}

// Starts `opencode serve` (its own server, not the background service) for the surrounding scope: on 127.0.0.1, a free port and a random password, with its
// whole configuration from `config` (OPENCODE_CONFIG_CONTENT) and the Claude Code compatibility (CLAUDE.md, skills)
// off. Closing the scope kills the process group.
export const startOpencodeServer = Effect.fn("startOpencodeServer")(function*(options: {
  readonly command: readonly [string, ...Array<string>]
  readonly cwd: string
  readonly config: object
  // a run's own variables (your keys, when you share them with OpenCode); Viral's OPENCODE_* settings win
  readonly env?: Readonly<Record<string, string>>
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const random = yield* SecureRandom.SecureRandom
  const password = (yield* random.uuidV7()).replaceAll("-", "")
  const port = yield* freePort
  const config = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(options.config).pipe(
    Effect.mapError((cause) => new AgentError({ code: "session", message: cause.message }))
  )
  const [bin, ...lead] = options.command
  const handle = yield* spawner.spawn(ChildProcess.make(bin, [...lead, "serve", "--hostname=127.0.0.1", `--port=${port}`], {
    cwd: options.cwd,
    detached: true,
    extendEnv: true,
    env: {
      ...options.env,
      OPENCODE_CONFIG_CONTENT: config,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "1"
    }
  })).pipe(
    Effect.mapError((cause) => new AgentError({ code: "session", message: `couldn't start OpenCode: ${cause.message}` }))
  )

  let output = ""
  const ready = yield* Deferred.make<string, AgentError>()
  yield* handle.all.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.suspend(() => {
        output = (output + chunk).slice(-OUTPUT_TAIL)
        const match = output.match(/server listening on\s+(https?:\/\/\S+)/i)
        return match === null ? Effect.void : Deferred.succeed(ready, match[1]!).pipe(Effect.asVoid)
      })
    ),
    Effect.ignore,
    Effect.andThen(Effect.suspend(() =>
      Deferred.fail(ready, new AgentError({ code: "session", message: `OpenCode exited before it was ready: ${output.trim()}` }))
    )),
    Effect.forkScoped
  )
  const url = yield* Deferred.await(ready).pipe(
    Effect.timeoutOrElse({
      duration: STARTUP_TIMEOUT,
      orElse: () => Effect.fail(new AgentError({ code: "session", message: `OpenCode didn't start: ${output.trim()}` }))
    })
  )
  const api = yield* makeOpencodeApi({ url, password }).pipe(Effect.provide(FetchHttpClient.layer))
  return { url, api } satisfies OpencodeServer
})

// `opencode --version`, or none when it isn't installed
export const opencodeVersion = Effect.fn("opencodeVersion")(function*(command: readonly [string, ...Array<string>]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const [bin, ...lead] = command
  return yield* spawner.string(ChildProcess.make(bin, [...lead, "--version"])).pipe(
    Effect.map((text) => Option.fromNullishOr(parseVersion(text)).pipe(Option.map((v) => v.join(".")))),
    Effect.orElseSucceed(() => Option.none<string>())
  )
})
