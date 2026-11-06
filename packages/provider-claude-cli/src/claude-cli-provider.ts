import { createSdkMcpServer, query, type SDKMessage, tool } from "@anthropic-ai/claude-agent-sdk"
import { Effect, Option, Path, Schema, Stream, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { AgentError, type AgentHooks, type AgentRun, type AgentTask, toolShape } from "@viral/provider-core"

const isInside = (dir: string, file: string, path: Path.Path) => {
  const relative = path.relative(dir, path.resolve(file))
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

// Runs an agent job on the user's installed Claude CLI through the Agent SDK. The session is isolated: no user
// settings, skills, plugins, MCP servers or claude.ai connectors; only the stage's tool, plus read-only access to
// the stage's folders. The system prompt (the stage's instructions followed by its skills) comes from the app. Cost
// and the session id are reported through `hooks`, so a rejected attempt can resume the same conversation with
// your note.
export const makeClaudeCliProvider = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const path = yield* Path.Path
  const claudePath = yield* spawner.string(ChildProcess.make("which", ["claude"])).pipe(
    Effect.map(Str.trim),
    Effect.orDie
  )

  const run: AgentRun = Effect.fn("ClaudeCli.run")(function*<S extends Schema.Top>(
    task: AgentTask<S>,
    hooks: AgentHooks,
    model: string | null,
    system: string
  ) {
    const readDirs = task.readDirs ?? []

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
            content: [{ type: "text", text: await Effect.runPromiseWith(services)(helper.run(args)) }]
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

    const onMessage = (message: SDKMessage): Effect.Effect<void, AgentError> => {
      switch (message.type) {
        case "system":
          return message.subtype === "init" ? hooks.recordSession(message.session_id) : Effect.void
        case "assistant":
          return Effect.forEach(message.message.content, (block) =>
            block.type === "text"
              ? hooks.progress(null, block.text)
              : block.type === "tool_use"
              ? hooks.progress(null, `→ ${block.name.replace(/^mcp__viral__/, "")}`)
              : Effect.void, { discard: true })
        case "result": {
          const usage = Object.values(message.modelUsage)
          // the CLI also makes small calls on a cheaper model; the stage's model is the one that wrote the most
          const main = Object.entries(message.modelUsage).sort(([, a], [, b]) => b.outputTokens - a.outputTokens)[0]
          const cost = hooks.recordCost({
            model: main?.[0] ?? model,
            inputTokens: usage.reduce((n, u) => n + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0),
            outputTokens: usage.reduce((n, u) => n + u.outputTokens, 0),
            costUsd: message.total_cost_usd
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
