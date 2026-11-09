import { Config, Deferred, Effect, FileSystem, Option, Queue, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { SecureRandom } from "effect/crypto"
import { AgentError, type AgentHooks, type AgentRun, type AgentTask, toolEndpoint } from "@viral/provider-core"
import { type CodexClient, codexClient, type CodexNotification } from "./codex-client.ts"

// Codex features a Viral run never uses. Each one would add tools or context the stage doesn't want: the shell,
// apps and plugins, the browser, sub-agents, the user's hooks and memories. `view_image` stays on only for stages
// that read images.
export const DISABLED_FEATURES = [
  "apps",
  "plugins",
  "remote_plugin",
  "browser_use",
  "browser_use_external",
  "in_app_browser",
  "computer_use",
  "image_generation",
  "multi_agent",
  "hooks",
  "goals",
  "memories",
  "shell_tool",
  "unified_exec",
  "sleep_tool",
  "tool_suggest",
  "skill_search",
  "skill_mcp_dependency_install",
  "workspace_dependencies"
] as const

// a stage's tool calls can run a render or a sheet, which takes longer than Codex's default MCP timeout
const TOOL_TIMEOUT_SEC = 600

export interface CodexOptions {
  // the codex binary (or a fake app-server in tests): command and leading arguments
  readonly command?: readonly [string, ...Array<string>]
  // where Codex keeps its config and login ($CODEX_HOME, else ~/.codex)
  readonly codexHome?: string
}

const UserMcpServers = Schema.fromJsonString(Schema.Array(Schema.Struct({ name: Schema.String, enabled: Schema.Boolean })))

// The MCP servers the user's config.toml defines. Only those can be switched off by name: setting
// `mcp_servers.<name>.enabled` for a server a plugin provides creates an entry with no transport, which Codex
// refuses to load (plugin servers are off anyway, with plugins).
export const configuredMcpServers = (configToml: string) =>
  new Set(Array.from(configToml.matchAll(/^\s*\[mcp_servers\.("?)([^".\]]+)\1\]/gm), (match) => match[2]!))

// The app-server's launch arguments for one run: isolated from the user's setup except for their login.
export const launchArgs = (userMcpServers: ReadonlyArray<string>, readsImages: boolean) => [
  "app-server",
  "--listen",
  "stdio://",
  ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  ...(readsImages ? [] : ["--disable", "view_image"]),
  // the user's skills (~/.codex/skills, ~/.agents/skills) stay out of the context
  "--enable",
  "skip_host_skill_discovery",
  "-c",
  "skills.bundled.enabled=false",
  "-c",
  "skills.include_instructions=false",
  "-c",
  `web_search="disabled"`,
  // each of the user's MCP servers is switched off by name (a whole `mcp_servers` table would replace their
  // definitions and fail to load)
  ...userMcpServers.flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`])
]

// Codex's model catalog for the signed-in account (model/list)
export const CodexModel = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  hidden: Schema.Boolean,
  isDefault: Schema.Boolean,
  defaultReasoningEffort: Schema.String,
  inputModalities: Schema.Array(Schema.String)
})
export type CodexModel = typeof CodexModel.Type
const ModelList = Schema.Struct({ data: Schema.Array(CodexModel), nextCursor: Schema.NullOr(Schema.String) })

export const listModels = (client: CodexClient) =>
  client.request("model/list", {}, ModelList).pipe(Effect.map((list) => list.data.filter((model) => !model.hidden)))

const Thread = Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) })
const TurnStarted = Schema.Struct({ turn: Schema.Struct({ id: Schema.String }) })

const Usage = Schema.Struct({ totalTokens: Schema.Number, inputTokens: Schema.Number, outputTokens: Schema.Number })
const TokenUsageUpdated = Schema.Struct({
  turnId: Schema.String,
  tokenUsage: Schema.Struct({ total: Usage, last: Usage })
})
const TurnCompleted = Schema.Struct({
  turn: Schema.Struct({
    id: Schema.String,
    status: Schema.String,
    error: Schema.NullOr(Schema.Struct({ message: Schema.String }))
  })
})
const ItemEvent = Schema.Struct({
  item: Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String), tool: Schema.optional(Schema.String) })
})
const ErrorEvent = Schema.Struct({ error: Schema.Struct({ message: Schema.String }), willRetry: Schema.Boolean })

const decodeAs = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
  Schema.decodeUnknownOption(schema)(value)

// Runs an agent job on the user's Codex CLI through `codex app-server`, signed in with their ChatGPT plan or API
// key. One app-server per run, in an empty scratch folder (no AGENTS.md to pick up), read-only sandbox, approvals
// never, and only Viral's tools (over the per-run MCP endpoint). The stage's system prompt replaces Codex's own
// (`baseInstructions`). The run stops as soon as the output tool accepts a result: the turn is interrupted, so
// Codex doesn't spend another round writing a summary. Codex reports tokens, not dollars.
export const makeCodexProvider = Effect.fn("makeCodexProvider")(function*(options: CodexOptions = {}) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    // the run's tool endpoint draws its bearer token from it; taken here so a run needs no other services
    const random = yield* SecureRandom.SecureRandom
    const fs = yield* FileSystem.FileSystem
    const [bin, ...lead] = options.command ?? ["codex"]

    const codexHome = options.codexHome ?? (yield* Config.String("CODEX_HOME").pipe(
      Config.orElse(() => Config.String("HOME").pipe(Config.map((home) => `${home}/.codex`))),
      Config.withDefault(""),
      Effect.orDie
    ))
    // the user's MCP servers that would start with the run, to switch off
    const userMcpServers = Effect.gen(function*() {
      const listed = yield* spawner.string(ChildProcess.make(bin, [...lead, "mcp", "list", "--json"])).pipe(
        Effect.flatMap(Schema.decodeEffect(UserMcpServers))
      )
      const configured = configuredMcpServers(yield* fs.readFileString(`${codexHome}/config.toml`).pipe(Effect.orElseSucceed(() => "")))
      return listed.filter((server) => server.enabled && configured.has(server.name)).map((server) => server.name)
    }).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))

    const run: AgentRun = Effect.fn("Codex.run")(function*<S extends Schema.Top>(
      task: AgentTask<S>,
      hooks: AgentHooks,
      model: string | null,
      system: string
    ) {
      const endpoint = yield* toolEndpoint(task).pipe(Effect.provideService(SecureRandom.SecureRandom, random))
      const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "viral-codex-" }).pipe(
        Effect.mapError((cause) => new AgentError({ code: "session", message: cause.message }))
      )
      const readsImages = (task.readDirs ?? []).length > 0
      const client = yield* codexClient(ChildProcess.make(bin, [...lead, ...launchArgs(yield* userMcpServers, readsImages)], {
        cwd: scratch,
        stdin: "pipe",
        // a cancel closes the scope, which kills the whole process group
        detached: true
      }))

      yield* client.request("initialize", { clientInfo: { name: "viral", title: "Viral", version: "1.0.0" }, capabilities: null }, Schema.Unknown)
      yield* client.notify("initialized")

      // the account's catalog decides the model and its effort: the user's config.toml may name a model their
      // plan doesn't offer, or an effort (xhigh) far beyond what a stage needs
      const catalog = yield* listModels(client)
      const chosen = catalog.find((entry) => model === null ? entry.isDefault : entry.id === model)
      if (chosen === undefined) {
        return yield* new AgentError({
          code: "no-model",
          message: model === null
            ? "Codex has no default model for this account"
            : `Codex doesn't offer ${model} on this account (it has ${catalog.map((entry) => entry.id).join(", ")})`
        })
      }

      const thread = {
        model: chosen.id,
        cwd: scratch,
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: system,
        config: {
          model_reasoning_effort: chosen.defaultReasoningEffort,
          [`mcp_servers.${endpoint.name}`]: {
            url: endpoint.url,
            http_headers: { Authorization: `Bearer ${endpoint.token}` },
            tool_timeout_sec: TOOL_TIMEOUT_SEC,
            // Codex asks before any MCP call, which "approvals never" turns into a refusal; Viral's tools are its own
            default_tools_approval_mode: "approve"
          }
        }
      }
      const started = task.resumeSession
        ? yield* client.request("thread/resume", { ...thread, threadId: task.resumeSession }, Thread)
        : yield* client.request("thread/start", { ...thread, ephemeral: false }, Thread)
      const threadId = started.thread.id
      yield* hooks.recordSession(threadId)

      const turn = yield* client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: task.message, text_elements: [] }]
      }, TurnStarted)

      // stop the turn once the result is in; the turn still completes (as "interrupted") and ends the loop below
      yield* Deferred.await(endpoint.submitted).pipe(
        Effect.andThen(client.request("turn/interrupt", { threadId, turnId: turn.turn.id }, Schema.Unknown)),
        Effect.ignore,
        Effect.forkScoped
      )

      const usage = yield* followTurn(client, turn.turn.id, hooks)
      yield* hooks.recordCost({ model: chosen.id, inputTokens: usage.input, outputTokens: usage.output, costUsd: 0 })

      const result = yield* Deferred.poll(endpoint.submitted)
      if (Option.isSome(result)) return yield* result.value
      if (usage.failure !== null) return yield* new AgentError({ code: "ended", message: usage.failure })
      const last = endpoint.lastOutput()
      if (Option.isNone(last)) {
        return yield* new AgentError({ code: "no-output", message: `the agent didn't call ${task.output.tool}` })
      }
      return yield* Schema.decodeUnknownEffect(task.output.schema)(last.value).pipe(
        Effect.mapError((error) => new AgentError({ code: "invalid-output", message: error.message }))
      )
    }, Effect.scoped)

    return run
})

// Reads notifications until the turn completes: progress for the agent's messages and tool calls, and the turn's
// token use (the thread's total minus what it had before this turn, so a resumed thread counts only this turn).
const followTurn = Effect.fnUntraced(function*(client: CodexClient, turnId: string, hooks: AgentHooks) {
  let before: { input: number; output: number } | null = null
  let latest = { input: 0, output: 0 }
  let failure: string | null = null
  const onNotification = (event: CodexNotification): Effect.Effect<boolean> => {
    switch (event.method) {
      case "thread/tokenUsage/updated":
        return Effect.sync(() => {
          const update = decodeAs(TokenUsageUpdated, event.params)
          if (Option.isNone(update) || update.value.turnId !== turnId) return false
          const { total, last } = update.value.tokenUsage
          before ??= { input: total.inputTokens - last.inputTokens, output: total.outputTokens - last.outputTokens }
          latest = { input: total.inputTokens - before.input, output: total.outputTokens - before.output }
          return false
        })
      case "item/started":
      case "item/completed": {
        const item = decodeAs(ItemEvent, event.params)
        if (Option.isNone(item)) return Effect.succeed(false)
        const { type, text, tool } = item.value.item
        if (event.method === "item/completed" && type === "agentMessage" && text) return hooks.progress(null, text).pipe(Effect.as(false))
        if (event.method === "item/started" && type === "mcpToolCall" && tool) return hooks.progress(null, `→ ${tool}`).pipe(Effect.as(false))
        return Effect.succeed(false)
      }
      case "error":
        return Effect.sync(() => {
          const error = decodeAs(ErrorEvent, event.params)
          if (Option.isSome(error) && !error.value.willRetry) failure = error.value.error.message
          return false
        })
      case "turn/completed":
        return Effect.sync(() => {
          const completed = decodeAs(TurnCompleted, event.params)
          if (Option.isNone(completed) || completed.value.turn.id !== turnId) return false
          if (completed.value.turn.status === "failed") failure = completed.value.turn.error?.message ?? "the turn failed"
          return true
        })
      default:
        return Effect.succeed(false)
    }
  }
  while (!(yield* Queue.take(client.notifications).pipe(Effect.flatMap(onNotification)))) {
    // until the turn completes
  }
  return { ...latest, failure }
})
