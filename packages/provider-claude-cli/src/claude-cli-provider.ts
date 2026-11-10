import { createSdkMcpServer, query, type SDKMessage, tool } from "@anthropic-ai/claude-agent-sdk"
import { Effect, Option, Path, Schema, Stream, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { AgentError, type AgentHooks, type AgentRun, type AgentTask, type CliEnvironment, NO_CLI_ENVIRONMENT, toolShape } from "@viral/provider-core"

const isInside = (dir: string, file: string, path: Path.Path) => {
  const relative = path.relative(dir, path.resolve(file))
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

// Runs an agent job on the user's installed Claude CLI through the Agent SDK. The session is isolated: no user
// settings, skills, plugins, MCP servers or claude.ai connectors; only the stage's tool, plus read-only access to
// the stage's folders. The system prompt (the stage's instructions followed by its skills) comes from the app. Cost
// and the session id are reported through `hooks`, so a rejected attempt can resume the same conversation with
// your note.
// A run's environment for the CLI: the server's own, with the run's variables over it (a key setup in Settings ›
// Accounts: an OpenRouter token, a config folder…). Undefined when there are none, so the CLI simply inherits.
export const claudeEnv = (base: Readonly<Record<string, string | undefined>>, extra: Readonly<Record<string, string>>) =>
  Object.keys(extra).length === 0 ? undefined : { ...base, ...extra }

// What a session's results have reported so far, per model. The CLI restores a session's totals on resume, so a
// resumed run's result reports the whole conversation (every model it ever ran on, every dollar), not this run.
export interface SessionTotals {
  readonly costUsd: number
  readonly models: Readonly<Record<string, { readonly costUsd: number; readonly outputTokens: number }>>
}

export interface RunResult {
  // the result message's cumulative figures (modelUsage, total_cost_usd)
  readonly totals: SessionTotals
  // output tokens per model of this run's own assistant messages
  readonly runModels: Readonly<Record<string, number>>
}

// This run's model and cost: the model that wrote most of this run's replies, and the session's totals minus what
// they were before this run. When the earlier totals aren't known (a session resumed after a restart), the model's
// cost is split by its output tokens; a fresh session's totals are this run's.
export const runCost = (result: RunResult, resumed: boolean, before: SessionTotals | undefined, fallbackModel: string | null) => {
  const ranked = Object.entries(result.runModels).sort(([, a], [, b]) => b - a)
  const byTotals = Object.entries(result.totals.models).sort(([, a], [, b]) => b.outputTokens - a.outputTokens)
  const model = ranked[0]?.[0] ?? (resumed ? fallbackModel : byTotals[0]?.[0]) ?? fallbackModel
  const round = (usd: number) => Math.round(usd * 1e8) / 1e8
  if (!resumed) return { model, costUsd: result.totals.costUsd }
  if (before !== undefined) return { model, costUsd: round(Math.max(0, result.totals.costUsd - before.costUsd)) }
  const costUsd = Object.entries(result.totals.models).reduce((sum, [name, total]) => {
    const mine = result.runModels[name] ?? 0
    return total.outputTokens > 0 ? sum + total.costUsd * Math.min(1, mine / total.outputTokens) : sum
  }, 0)
  return { model, costUsd: round(costUsd) }
}

export interface ClaudeCliOptions {
  // the claude executable (a fake in tests); found on the PATH otherwise
  readonly claudePath?: string
}

export const makeClaudeCliProviderWith = Effect.fn("makeClaudeCliProvider")(function*(options: ClaudeCliOptions = {}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const path = yield* Path.Path
  const claudePath = options.claudePath ?? (yield* spawner.string(ChildProcess.make("which", ["claude"])).pipe(
    Effect.map(Str.trim),
    Effect.orDie
  ))

  // each session's totals as last reported, so a resumed run records only its own cost
  const sessionTotals = new Map<string, SessionTotals>()

  const run: AgentRun = Effect.fn("ClaudeCli.run")(function*<S extends Schema.Top>(
    task: AgentTask<S>,
    hooks: AgentHooks,
    model: string | null,
    system: string,
    cli: CliEnvironment = NO_CLI_ENVIRONMENT
  ) {
    const readDirs = task.readDirs ?? []
    const env = claudeEnv(process.env, cli.env)

    const helpers = task.tools ?? []
    const services = yield* Effect.context<never>()
    let submitted: Option.Option<unknown> = Option.none()
    const server = createSdkMcpServer({
      name: "viral",
      tools: [
        tool(task.output.tool, task.output.description, toolShape(task.output.schema), async (args) => {
          submitted = Option.some(args)
          return { content: [{ type: "text", text: "Received. Stop here." }] }
        }),
        ...helpers.map((helper) =>
          tool(helper.name, helper.description, toolShape(helper.schema), async (args) => ({
            content: [{ type: "text", text: (await Effect.runPromiseWith(services)(helper.run(args))).text }]
          }))
        )
      ]
    })

    // Aborting on scope close stops the claude subprocess when the stage is cancelled.
    const session = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const abortController = new AbortController()
        const messages = query({
          prompt: task.message,
          options: {
            abortController,
            pathToClaudeCodeExecutable: claudePath,
            ...(env === undefined ? {} : { env }),
            ...(model === null ? {} : { model }),
            ...(task.resumeSession ? { resume: task.resumeSession } : {}),
            systemPrompt: system,
            tools: readDirs.length > 0 ? ["Read"] : [],
            settingSources: [],
            mcpServers: { viral: server },
            strictMcpConfig: true,
            settings: { disableClaudeAiConnectors: true },
            allowedTools: [task.output.tool, ...helpers.map((h) => h.name)].map((name) => `mcp__viral__${name}`),
            // End the session the moment the result is submitted. Otherwise the model takes one more full
            // turn (thinking plus a "done" message), re-reading the whole context for nothing.
            hooks: {
              PostToolUse: [{
                matcher: `mcp__viral__${task.output.tool}`,
                hooks: [() => Promise.resolve({ continue: false, stopReason: "result submitted" })]
              }]
            },
            // anything not allowed above lands here: only reads inside the stage's folders pass
            canUseTool: async (toolName, input) => {
              const file = typeof input.file_path === "string" ? input.file_path : ""
              return toolName === "Read" && readDirs.some((dir) => isInside(dir, file, path))
                ? { behavior: "allow", updatedInput: input }
                : { behavior: "deny", message: `${toolName} isn't available in this stage` }
            },
            maxTurns: task.maxTurns ?? 8
          }
        })
        return { abortController, messages }
      }),
      ({ abortController }) => Effect.sync(() => abortController.abort())
    )

    // this run's assistant messages (one per content block, sharing the message's id and usage): output per model
    const replies = new Map<string, { readonly model: string; readonly outputTokens: number }>()
    const onMessage = (message: SDKMessage): Effect.Effect<void, AgentError> => {
      switch (message.type) {
        case "system":
          return message.subtype === "init" ? hooks.recordSession(message.session_id) : Effect.void
        case "assistant":
          replies.set(message.message.id, { model: message.message.model, outputTokens: message.message.usage?.output_tokens ?? 0 })
          return Effect.forEach(message.message.content, (block) =>
            block.type === "text"
              ? hooks.progress(null, block.text)
              : block.type === "tool_use"
              ? hooks.progress(null, `→ ${block.name.replace(/^mcp__viral__/, "")}`)
              : Effect.void, { discard: true })
        case "result": {
          const totals: SessionTotals = {
            costUsd: message.total_cost_usd,
            models: Object.fromEntries(Object.entries(message.modelUsage).map(([name, u]) => [name, { costUsd: u.costUSD, outputTokens: u.outputTokens }]))
          }
          const runModels: Record<string, number> = {}
          for (const reply of replies.values()) runModels[reply.model] = (runModels[reply.model] ?? 0) + reply.outputTokens
          // the CLI also makes small calls on a cheaper model; the stage's model is the one that wrote the most
          const resumed = Boolean(task.resumeSession)
          const own = runCost(
            { totals, runModels },
            resumed,
            resumed ? sessionTotals.get(task.resumeSession!) : undefined,
            model
          )
          sessionTotals.set(message.session_id, totals)
          const usage = message.usage
          const cost = hooks.recordCost({
            model: own.model,
            inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
            outputTokens: usage.output_tokens,
            costUsd: own.costUsd
          })
          // ending after the tool call (e.g. on the turn limit) is fine; ending without it is reported below
          return message.subtype === "success" || Option.isSome(submitted)
            ? cost
            : cost.pipe(Effect.andThen(Effect.fail(new AgentError({ code: "ended", message: `the agent ended with ${message.subtype}` }))))
        }
        default:
          return Effect.void
      }
    }

    yield* Stream.fromAsyncIterable(session.messages, (cause) => new AgentError({ code: "session", message: String(cause) })).pipe(
      Stream.runForEach(onMessage)
    )

    if (Option.isNone(submitted)) {
      return yield* new AgentError({ code: "no-output", message: `the agent didn't call ${task.output.tool}` })
    }
    return yield* Schema.decodeUnknownEffect(task.output.schema)(submitted.value).pipe(
      Effect.mapError((error) => new AgentError({ code: "invalid-output", message: error.message }))
    )
  }, Effect.scoped)

  return run
})

export const makeClaudeCliProvider = makeClaudeCliProviderWith()
