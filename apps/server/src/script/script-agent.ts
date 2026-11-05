import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { NodeServices } from "@effect/platform-node"
import { type JobEvent, Script } from "@viral/contracts"
import { Context, Effect, Layer, Schema, Stream, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { makeProposeScriptServer, PROPOSE_SCRIPT_TOOL } from "./propose-script-tool.ts"
import { buildScriptPrompt, SCRIPT_WRITER_SYSTEM_PROMPT } from "./script-prompt.ts"

export class AgentError extends Schema.TaggedError<AgentError>()("AgentError", {
  message: Schema.String
}) {}

type Emit = (event: JobEvent) => Effect.Effect<void>

// Drives the user's installed Claude CLI through the Agent SDK. The agent hands
// its result back through an in-process MCP tool so the server can validate it.
export class ScriptAgent extends Context.Service<ScriptAgent, {
  writeScript(transcript: string, emit: Emit): Effect.Effect<Script, AgentError>
}>()("@viral/server/script/script-agent/ScriptAgent") {
  static readonly layer = Layer.effect(
    ScriptAgent,
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const claudePath = yield* spawner.string(ChildProcess.make("which", ["claude"])).pipe(
        Effect.map(Str.trim),
        Effect.orDie
      )

      const writeScript = Effect.fn("ScriptAgent.writeScript")(function*(transcript: string, emit: Emit) {
        let proposed: unknown = undefined
        const server = makeProposeScriptServer((input) => {
          proposed = input
        })

        // Aborting on scope close is what stops the claude subprocess when the job is cancelled.
        const session = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const abortController = new AbortController()
            const messages = query({
              prompt: buildScriptPrompt(transcript),
              options: {
                abortController,
                pathToClaudeCodeExecutable: claudePath,
                model: "haiku",
                systemPrompt: SCRIPT_WRITER_SYSTEM_PROMPT,
                tools: [],
                // Isolate the session from the user's own MCP servers and claude.ai
                // connectors: only our app tools should reach the model.
                mcpServers: { viral: server },
                strictMcpConfig: true,
                settings: { disableClaudeAiConnectors: true },
                allowedTools: [PROPOSE_SCRIPT_TOOL],
                settingSources: [],
                persistSession: false,
                maxTurns: 4
              }
            })
            return { abortController, messages }
          }),
          ({ abortController }) => Effect.sync(() => abortController.abort())
        )

        const onMessage = (message: SDKMessage): Effect.Effect<void, AgentError> => {
          if (message.type === "assistant") {
            return Effect.forEach(message.message.content, (block) =>
              block.type === "text"
                ? emit({ _tag: "AgentText", text: block.text })
                : block.type === "tool_use"
                ? emit({ _tag: "ToolCalled", name: block.name })
                : Effect.void, { discard: true })
          }
          if (message.type === "result" && message.subtype !== "success") {
            return Effect.fail(new AgentError({ message: `agent ended with ${message.subtype}` }))
          }
          return Effect.void
        }

        yield* Stream.fromAsyncIterable(session.messages, (cause) => new AgentError({ message: String(cause) })).pipe(
          Stream.runForEach(onMessage)
        )

        return yield* Schema.decodeUnknownEffect(Script)(proposed).pipe(
          Effect.mapError(() => new AgentError({ message: "agent did not submit a valid script" }))
        )
      }, Effect.scoped)

      return ScriptAgent.of({ writeScript })
    })
  ).pipe(Layer.provide(NodeServices.layer))
}
