import { Deferred, Effect, FileSystem, Option, Schema, Stream } from "effect"
import { AgentError, type AgentHooks, type AgentRun, type AgentTask, toolEndpoint } from "@viral/provider-core"
import type { OpencodeEvent, SessionInfo } from "./opencode-api.ts"
import { atLeast, MIN_OPENCODE_VERSION, opencodeVersion, startOpencodeServer, updateHint } from "./opencode-server.ts"

export interface OpencodeOptions {
  // the opencode binary (or a fake in tests): command and leading arguments
  readonly command?: readonly [string, ...Array<string>]
  // the oldest version to run (MIN_OPENCODE_VERSION); lowered only to probe an older install
  readonly minVersion?: string
}

const AGENT = "viral"

// The whole OpenCode configuration for one run. Every tool is denied except Viral's own (`viral_*`) and, for a
// stage that reads images, reading inside its folders; no edits, shell, web, sub-agents or skills. Rules are
// OpenCode 2's ordered permission rules (the last one that matches wins). The agent's prompt is the stage's system
// prompt.
export const runConfig = (options: {
  readonly system: string
  readonly endpoint: { readonly url: string; readonly token: string; readonly name: string }
  readonly readDirs: ReadonlyArray<string>
}) => {
  const permissions = [
    { action: "*", resource: "*", effect: "deny" },
    ...options.readDirs.flatMap((dir) => [
      { action: "read", resource: `${dir}/**`, effect: "allow" },
      { action: "external_directory", resource: `${dir}/**`, effect: "allow" }
    ]),
    { action: `${options.endpoint.name}_*`, resource: "*", effect: "allow" }
  ]
  return {
    $schema: "https://opencode.ai/config.json",
    update: "disable",
    share: "disabled",
    snapshots: false,
    plugins: [],
    instructions: [],
    formatter: false,
    lsp: false,
    websearch: false,
    default_agent: AGENT,
    permissions,
    mcp: {
      servers: {
        [options.endpoint.name]: {
          type: "remote",
          url: options.endpoint.url,
          headers: { Authorization: `Bearer ${options.endpoint.token}` },
          oauth: false
        }
      }
    },
    agents: {
      [AGENT]: { mode: "primary", description: "Viral's agent stage", system: options.system, permissions }
    }
  }
}

// "provider/model" (OpenCode's ids), split at the first slash
export const modelRef = (model: string) => {
  const slash = model.indexOf("/")
  return slash <= 0 ? null : { providerID: model.slice(0, slash), id: model.slice(slash + 1) }
}

// a provider retrying on a refusal only you can fix (a sign-in, credit) fails the run at once; any other retry after
// a few attempts
const GIVE_UP_STATUS = new Set([401, 402, 403])
const MAX_RETRIES = 3
// once the result is in, how long the step that sent it has to finish (so its cost is counted) before the turn is
// interrupted, and how long the interrupted turn has to wind down
const STEP_END = "10 seconds"
const WIND_DOWN = "15 seconds"

// Runs an agent job on the user's OpenCode 2, on whatever providers they've signed in to there (the OpenCode
// Console, their own keys…). One `opencode serve` per run in an empty scratch folder, configured entirely by Viral;
// sessions live in OpenCode's own store, so a rejected attempt resumes the same session (moved into the new folder).
// The turn is interrupted as soon as the output tool accepts a result and its step has ended. OpenCode keeps each
// session's dollar cost, so a turn's cost is the difference.
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
    const { api } = yield* startOpencodeServer({
      command,
      cwd: scratch,
      config: runConfig({ system, endpoint, readDirs: task.readDirs ?? [] })
    })

    const sessionID = task.resumeSession
      ? task.resumeSession
      : (yield* api.createSession({ title: `Viral · ${task.stage}`, agent: AGENT, model: ref, directory: scratch })).id
    if (task.resumeSession) {
      yield* api.moveSession(sessionID, scratch)
      yield* api.switchAgent(sessionID, AGENT)
      if (ref !== null) yield* api.switchModel(sessionID, ref)
    }
    yield* hooks.recordSession(sessionID)
    // the session's totals before this turn: its cost is the difference
    const before = yield* api.getSession(sessionID)

    // the turn ends with the execution (finished, interrupted or failed)
    const ended = yield* Deferred.make<void, AgentError>()
    const connected = yield* Deferred.make<void>()
    const stepAfterResult = yield* Deferred.make<void>()
    yield* followEvents(api.events, sessionID, hooks, { ended, connected, stepAfterResult, resultIn: Deferred.isDone(endpoint.submitted) }).pipe(Effect.forkScoped)
    yield* Deferred.await(connected).pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.fail(new AgentError({ code: "session", message: "OpenCode's event stream didn't open" }))
      })
    )
    // stop as soon as the result is in: when the step that sent it has ended (an interrupted step reports no cost)
    const stop = Deferred.await(endpoint.submitted).pipe(
      Effect.ignore,
      Effect.andThen(Deferred.await(stepAfterResult).pipe(Effect.timeout(STEP_END), Effect.ignore)),
      Effect.andThen(api.interrupt(sessionID).pipe(Effect.ignore)),
      Effect.andThen(Deferred.await(ended).pipe(Effect.ignore, Effect.timeout(WIND_DOWN), Effect.ignore))
    )

    yield* api.prompt(sessionID, task.message)
    const turn = yield* Deferred.await(ended).pipe(Effect.raceFirst(stop), Effect.result)

    const after = yield* api.getSession(sessionID)
    const tokens = (s: SessionInfo) => ({
      input: s.tokens.input + s.tokens.cache.read + s.tokens.cache.write,
      output: s.tokens.output + s.tokens.reasoning
    })
    yield* hooks.recordCost({
      model: after.model === undefined ? model : `${after.model.providerID}/${after.model.id}`,
      inputTokens: tokens(after).input - tokens(before).input,
      outputTokens: tokens(after).output - tokens(before).output,
      costUsd: after.cost - before.cost
    })

    const result = yield* Deferred.poll(endpoint.submitted)
    if (Option.isSome(result)) return yield* result.value
    if (turn._tag === "Failure") return yield* turn.failure
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

// The server's events for the session: live progress (the agent's text once a part is finished, and each tool it
// starts), the first step to end after the result is in, and the end of the turn. A failed execution fails `ended`,
// as does a retry only you can fix.
const followEvents = (
  events: Stream.Stream<OpencodeEvent, AgentError>,
  sessionID: string,
  hooks: AgentHooks,
  signals: {
    readonly ended: Deferred.Deferred<void, AgentError>
    readonly connected: Deferred.Deferred<void>
    readonly stepAfterResult: Deferred.Deferred<void>
    readonly resultIn: Effect.Effect<boolean>
  }
) => {
  const { ended, connected, stepAfterResult, resultIn } = signals
  const announced = new Set<string>()
  const end = (error: AgentError | null) =>
    (error === null ? Deferred.succeed(ended, undefined) : Deferred.fail(ended, error)).pipe(Effect.asVoid)
  return events.pipe(
    Stream.runForEach((event) => {
      if (event.type === "server.connected") return Deferred.succeed(connected, undefined).pipe(Effect.asVoid)
      if (event.data.sessionID !== sessionID) return Effect.void
      switch (event.type) {
        case "session.text.ended":
          return event.data.text.trim() === "" ? Effect.void : hooks.progress(null, event.data.text)
        case "session.tool.input.started":
          if (announced.has(event.data.id)) return Effect.void
          announced.add(event.data.id)
          return hooks.progress(null, `→ ${event.data.name.replace(/^viral_/, "")}`)
        case "session.step.ended":
          return resultIn.pipe(
            Effect.flatMap((done) => done ? Deferred.succeed(stepAfterResult, undefined) : Effect.succeed(false)),
            Effect.asVoid
          )
        case "session.execution.succeeded":
        case "session.execution.interrupted":
          return end(null)
        case "session.execution.failed":
          return end(new AgentError({ code: "ended", message: event.data.error.message }))
        case "session.retry.scheduled": {
          const { attempt, error } = event.data
          const hopeless = (error.status !== undefined && GIVE_UP_STATUS.has(error.status)) || attempt >= MAX_RETRIES
          return hopeless ? end(new AgentError({ code: "ended", message: error.message })) : Effect.void
        }
      }
    }),
    // the stream breaking off ends the turn too, rather than leaving it waiting
    Effect.catch((error) => end(error)),
    Effect.andThen(end(new AgentError({ code: "session", message: "OpenCode's event stream ended" })))
  )
}
