import { Deferred, Effect, Queue, Schema, Stream } from "effect"
import { type ChildProcess, ChildProcessSpawner } from "effect/process"
import { AgentError } from "@viral/provider-core"

// One line from `codex app-server`: a response to our request, a notification, or a request of its own.
const Incoming = Schema.fromJsonString(Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String }))
}))

export interface CodexNotification {
  readonly method: string
  readonly params: unknown
}

export interface CodexClient {
  // sends a request and decodes its result
  request<A, I>(method: string, params: unknown, schema: Schema.Codec<A, I>): Effect.Effect<A, AgentError>
  notify(method: string, params?: unknown): Effect.Effect<void>
  // every notification, in order; fails with an AgentError once the app-server exits
  readonly notifications: Queue.Dequeue<CodexNotification, AgentError>
}

const STDERR_TAIL = 2_000

const encoder = new TextEncoder()

// A small JSON-RPC client for `codex app-server` over stdio (one JSON object per line, no "jsonrpc" field), for
// the dozen methods Viral uses. The app-server's own requests (approvals, MCP elicitations) are declined: Viral's
// runs never ask for approval. The process lives for the surrounding scope; closing it kills the process group.
export const codexClient = Effect.fn("codexClient")(function*(command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const outgoing = yield* Queue.unbounded<Uint8Array>()
  const notifications = yield* Queue.unbounded<CodexNotification, AgentError>()
  const pending = new Map<number, Deferred.Deferred<unknown, AgentError>>()
  let nextId = 1
  let stderr = ""

  const handle = yield* spawner.spawn(command).pipe(
    Effect.mapError((cause) => new AgentError({ code: "session", message: `couldn't start Codex: ${cause.message}` }))
  )
  const send = (message: object) => Queue.offer(outgoing, encoder.encode(`${JSON.stringify(message)}\n`))

  yield* Stream.fromQueue(outgoing).pipe(Stream.run(handle.stdin), Effect.ignore, Effect.forkScoped)
  yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) => Effect.sync(() => void (stderr = (stderr + chunk).slice(-STDERR_TAIL)))),
    Effect.ignore,
    Effect.forkScoped
  )

  const onLine = (raw: string) =>
    Schema.decodeEffect(Incoming)(raw).pipe(
      Effect.flatMap((message) => {
        if (message.method !== undefined && message.id !== undefined) {
          const answer = message.method === "mcpServer/elicitation/request"
            ? { id: message.id, result: { action: "decline", content: null, _meta: null } }
            : { id: message.id, error: { code: -32601, message: `Viral doesn't handle ${message.method}` } }
          return send(answer)
        }
        if (message.method !== undefined) {
          return Queue.offer(notifications, { method: message.method, params: message.params })
        }
        const waiting = typeof message.id === "number" ? pending.get(message.id) : undefined
        if (waiting === undefined) return Effect.void
        pending.delete(message.id as number)
        return message.error === undefined
          ? Deferred.succeed(waiting, message.result)
          : Deferred.fail(waiting, new AgentError({ code: "session", message: `Codex: ${message.error.message}` }))
      }),
      Effect.catchTag("SchemaError", () => Effect.logWarning("unparsed codex line", { line: raw.slice(0, 200) })),
      Effect.asVoid
    )

  // when the app-server exits, every waiting request and the notification stream fail with its stderr
  const exited = Effect.suspend(() => {
    const error = new AgentError({
      code: "session",
      message: `the Codex app-server exited${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`
    })
    return Effect.forEach(pending.values(), (waiting) => Deferred.fail(waiting, error), { discard: true }).pipe(
      Effect.andThen(Queue.fail(notifications, error))
    )
  })
  yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach(onLine),
    Effect.ignore,
    Effect.andThen(exited),
    Effect.forkScoped
  )

  const request = Effect.fnUntraced(function*<A, I>(method: string, params: unknown, schema: Schema.Codec<A, I>) {
    const id = nextId++
    const response = yield* Deferred.make<unknown, AgentError>()
    pending.set(id, response)
    yield* send({ id, method, params })
    const result = yield* Deferred.await(response)
    return yield* Schema.decodeUnknownEffect(schema)(result).pipe(
      Effect.mapError((error) => new AgentError({ code: "session", message: `Codex ${method}: ${error.message}` }))
    )
  })

  return {
    request,
    notify: (method: string, params?: unknown) => send(params === undefined ? { method } : { method, params }).pipe(Effect.asVoid),
    notifications
  } satisfies CodexClient
})
