import type { Part } from "@opencode-ai/sdk/v2/client"
import { Deferred, Effect, FileSystem, Option, Schema, Stream } from "effect"
import { AgentError, type AgentHooks, type AgentRun, type AgentTask, toolEndpoint } from "@viral/provider-core"
import { atLeast, MIN_OPENCODE_VERSION, type OpencodeServer, opencodeVersion, startOpencodeServer, updateHint } from "./opencode-server.ts"

export interface OpencodeOptions {
  // the opencode binary (or a fake in tests): command and leading arguments
  readonly command?: readonly [string, ...Array<string>]
  // the oldest version to run (MIN_OPENCODE_VERSION); lowered only to probe an older install
  readonly minVersion?: string
}

const AGENT = "viral"

// The whole OpenCode configuration for one run. Every tool is denied except Viral's own (`viral_*`) and, for a
// stage that reads images, reading inside its folders; no edits, shell, web, sub-agents or skills. The agent's
// prompt is the stage's system prompt.
export const runConfig = (options: {
  readonly system: string
  readonly endpoint: { readonly url: string; readonly token: string; readonly name: string }
  readonly readDirs: ReadonlyArray<string>
}) => {
  const inside = (action: "allow" | "deny") =>
    options.readDirs.length === 0
      ? "deny" as const
      : { "*": "deny" as const, ...Object.fromEntries(options.readDirs.map((dir) => [`${dir}/**`, action])) }
  const permission = {
    "*": "deny",
    read: inside("allow"),
    external_directory: inside("allow"),
    edit: "deny",
    bash: "deny",
    webfetch: "deny",
    websearch: "deny",
    task: "deny",
    skill: "deny",
    question: "deny",
    [`${options.endpoint.name}_*`]: "allow"
  }
  return {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    share: "disabled",
    snapshot: false,
    plugin: [],
    instructions: [],
    formatter: false,
    lsp: false,
    default_agent: AGENT,
    permission,
    mcp: {
      [options.endpoint.name]: {
        type: "remote",
        url: options.endpoint.url,
        headers: { Authorization: `Bearer ${options.endpoint.token}` },
        oauth: false,
        enabled: true
      }
    },
    agent: {
      [AGENT]: { mode: "primary", description: "Viral's agent stage", prompt: options.system, permission }
    }
  }
}

// "provider/model" (OpenCode's ids), split at the first slash
export const modelRef = (model: string) => {
  const slash = model.indexOf("/")
  return slash <= 0 ? null : { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
}

const promise = <A>(what: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new AgentError({ code: "session", message: `OpenCode ${what}: ${cause instanceof Error ? cause.message : String(cause)}` }) })

// Runs an agent job on the user's OpenCode, on whatever providers they've signed in to there (OpenCode Zen, their
// own keys…). One `opencode serve` per run in an empty scratch folder, configured entirely by Viral; sessions live in
// OpenCode's own store, so a rejected attempt resumes the same session. The session is aborted as soon as the
// output tool accepts a result. OpenCode reports the dollar cost of each answer.
export const makeOpencodeProvider = Effect.fn("makeOpencodeProvider")(function*(options: OpencodeOptions = {}) {
  const fs = yield* FileSystem.FileSystem
  const command = options.command ?? ["opencode"]

  const run: AgentRun = Effect.fn("Opencode.run")(function*<S extends Schema.Top>(
    task: AgentTask<S>,
    hooks: AgentHooks,
    model: string | null,
    system: string
  ) {
    const version = yield* opencodeVersion(command)
    if (Option.isNone(version)) {
      return yield* new AgentError({ code: "session", message: "OpenCode isn't installed" })
    }
    const minVersion = options.minVersion ?? MIN_OPENCODE_VERSION
    if (!atLeast(version.value, minVersion)) {
      return yield* new AgentError({
        code: "outdated",
        message: `OpenCode ${version.value} is older than ${minVersion}, which Viral needs. ${updateHint}`
      })
    }
    const ref = model === null ? null : modelRef(model)
    if (model !== null && ref === null) {
      return yield* new AgentError({ code: "no-model", message: `"${model}" isn't an OpenCode model id (provider/model)` })
    }

    const endpoint = yield* toolEndpoint(task)
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "viral-opencode-" }).pipe(
      Effect.mapError((cause) => new AgentError({ code: "session", message: cause.message }))
    )
    const server = yield* startOpencodeServer({
      command,
      cwd: scratch,
      config: runConfig({ system, endpoint, readDirs: task.readDirs ?? [] })
    })
    const { client } = server

    const sessionID = task.resumeSession
      ? task.resumeSession
      : (yield* promise("session", () => client.session.create({ title: `Viral · ${task.stage}` }, { throwOnError: true }))).data.id
    yield* hooks.recordSession(sessionID)
    const before = new Set((yield* promise("messages", () => client.session.messages({ sessionID }, { throwOnError: true }))).data.map((m) => m.info.id))

    // a session error (out of credit, a bad key…) ends the run even if the prompt call never returns
    const failed = yield* Deferred.make<never, AgentError>()
    yield* followEvents(server, sessionID, hooks, failed).pipe(Effect.forkScoped)
    // stop as soon as the result is in
    yield* Deferred.await(endpoint.submitted).pipe(
      Effect.andThen(promise("abort", () => client.session.abort({ sessionID }))),
      Effect.ignore,
      Effect.forkScoped
    )

    const answer = yield* promise("prompt", () =>
      client.session.prompt({
        sessionID,
        agent: AGENT,
        ...(ref === null ? {} : { model: ref }),
        parts: [{ type: "text", text: task.message }]
      }, { throwOnError: true })
    ).pipe(Effect.raceFirst(Deferred.await(failed)), Effect.result)

    // every answer of this turn (a tool call is a step of its own) with its cost
    const turn = (yield* promise("messages", () => client.session.messages({ sessionID }, { throwOnError: true }))).data
      .flatMap((m) => m.info.role === "assistant" && !before.has(m.info.id) ? [m.info] : [])
    yield* hooks.recordCost({
      model: turn.at(-1) === undefined ? model : `${turn.at(-1)!.providerID}/${turn.at(-1)!.modelID}`,
      inputTokens: turn.reduce((n, m) => n + m.tokens.input + m.tokens.cache.read + m.tokens.cache.write, 0),
      outputTokens: turn.reduce((n, m) => n + m.tokens.output + m.tokens.reasoning, 0),
      costUsd: turn.reduce((n, m) => n + m.cost, 0)
    })

    const result = yield* Deferred.poll(endpoint.submitted)
    if (Option.isSome(result)) return yield* result.value
    if (answer._tag === "Failure") return yield* answer.failure
    const error = turn.find((m) => m.error !== undefined)?.error
    if (error !== undefined) return yield* new AgentError({ code: "ended", message: errorMessage(error) })
    const last = endpoint.lastOutput()
    if (Option.isNone(last)) {
      return yield* new AgentError({ code: "no-output", message: `the agent didn't call ${task.output.tool}` })
    }
    return yield* Schema.decodeUnknownEffect(task.output.schema)(last.value).pipe(
      Effect.mapError((cause) => new AgentError({ code: "invalid-output", message: cause.message }))
    )
  }, Effect.scoped)

  return run
})

const errorMessage = (error: { readonly name: string; readonly data?: unknown }) =>
  typeof error.data === "object" && error.data !== null && "message" in error.data ? String(error.data.message) : error.name

// The server's events for the session: live progress (the agent's text once a part is finished, and each tool it
// starts) and session errors, which fail `failed` (Viral's own abort isn't one), as does a retry only you can fix.
const followEvents = (server: OpencodeServer, sessionID: string, hooks: AgentHooks, failed: Deferred.Deferred<never, AgentError>) => {
  const announced = new Set<string>()
  const onPart = (part: Part) => {
    if (part.sessionID !== sessionID) return Effect.void
    if (part.type === "text" && part.time?.end !== undefined && part.text.trim() !== "" && !announced.has(part.id)) {
      announced.add(part.id)
      return hooks.progress(null, part.text)
    }
    if (part.type === "tool" && !announced.has(part.callID)) {
      announced.add(part.callID)
      return hooks.progress(null, `→ ${part.tool.replace(/^viral_/, "")}`)
    }
    return Effect.void
  }
  // the SSE client reconnects forever unless aborted, so the subscription is tied to the run's scope
  const controller = Effect.acquireRelease(Effect.sync(() => new AbortController()), (c) => Effect.sync(() => c.abort()))
  return controller.pipe(
    Effect.flatMap((c) => promise("events", () => server.client.event.subscribe({}, { signal: c.signal, sseMaxRetryAttempts: 1 }))),
    Effect.flatMap((events) =>
      Stream.fromAsyncIterable(events.stream, (cause) => new AgentError({ code: "session", message: String(cause) })).pipe(
        Stream.runForEach((event) => {
          if (event.type === "message.part.updated") return onPart(event.properties.part)
          if (event.type === "session.error" && event.properties.sessionID === sessionID && event.properties.error !== undefined && event.properties.error.name !== "MessageAbortedError") {
            return Deferred.fail(failed, new AgentError({ code: "ended", message: errorMessage(event.properties.error) })).pipe(Effect.asVoid)
          }
          // a retry that needs you to act (a free tier's limit, a sign-in) would retry forever: OpenCode 1.19 keeps
          // the prompt open and only reports it as a session status
          if (event.type === "session.status" && event.properties.sessionID === sessionID && event.properties.status.type === "retry" && event.properties.status.action !== undefined) {
            const { action } = event.properties.status
            return Deferred.fail(failed, new AgentError({ code: "ended", message: `${action.title}: ${action.message}` })).pipe(Effect.asVoid)
          }
          return Effect.void
        })
      )
    ),
    Effect.ignore,
    Effect.scoped
  )
}
