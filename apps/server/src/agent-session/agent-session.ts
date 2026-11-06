import { createSdkMcpServer, query, type SDKMessage, tool } from "@anthropic-ai/claude-agent-sdk"
import { NodeServices } from "@effect/platform-node"
import { Context, Effect, Layer, Option, Path, Schema, Stream, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { fromJSONSchema, type ZodObject } from "zod"
import { type SkillName, SkillPack } from "../agent-skills/skill-pack.ts"
import { Settings } from "../settings/settings.ts"

// `code`: "session" (the CLI or SDK failed), "no-output" (the agent never called its tool), "invalid-output"
// (it called it with something the schema rejects), or "ended" (the session ended with an error).
export class AgentError extends Schema.TaggedError<AgentError>()("AgentError", {
  code: Schema.String,
  message: Schema.String
}) {}

// A helper tool a stage offers besides its output tool (e.g. a detail contact sheet). Its result is text
// for the agent; a bad input comes back as text too, so the agent can correct it.
export interface AgentTool {
  readonly name: string
  readonly description: string
  readonly schema: Schema.Top
  run(input: unknown): Effect.Effect<string>
}

export const agentTool = <A, I>(spec: {
  readonly name: string
  readonly description: string
  readonly schema: Schema.Codec<A, I>
  readonly run: (input: A) => Effect.Effect<string>
}): AgentTool => ({
  name: spec.name,
  description: spec.description,
  schema: spec.schema,
  run: (input) =>
    Schema.decodeUnknownEffect(spec.schema)(input).pipe(
      Effect.matchEffect({ onFailure: (error) => Effect.succeed(`invalid input: ${error.message}`), onSuccess: spec.run })
    )
})

// One agent job: a stage asks for one structured result.
export interface AgentTask<S extends Schema.Top> {
  readonly stage: string
  // the stage's job and tool contract; the domain knowledge comes from `skills`
  readonly instructions: string
  readonly skills: ReadonlyArray<SkillName>
  // the user turn: the material to work on, or your note when resuming after a rejection
  readonly message: string
  // the agent returns its result by calling this tool; the schema checks it and is also the tool's input schema
  readonly output: { readonly tool: string; readonly description: string; readonly schema: S }
  // null = your Claude CLI's default model; a `stage.<name>.model` setting overrides either
  readonly defaultModel: string | null
  // folders the agent may read files from (contact sheets for the vision stages); nothing else is readable
  readonly readDirs?: ReadonlyArray<string>
  // helper tools the agent may call before submitting
  readonly tools?: ReadonlyArray<AgentTool>
  readonly maxTurns?: number
  // continue an earlier conversation (a rejected attempt) instead of starting fresh
  readonly resumeSession?: string | null
}

export interface AgentHooks {
  progress(pct: number | null, message?: string): Effect.Effect<void>
  recordCost(cost: {
    readonly model: string | null
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costUsd: number
  }): Effect.Effect<void>
  recordSession(sessionId: string): Effect.Effect<void>
}

// The JSON Schema of an Effect Schema, as the zod shape the Agent SDK's tool() takes. One schema serves both
// as the tool's input contract for the model and as the server-side check.
export const toolShape = (schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(schema)
  const zod = fromJSONSchema({ ...document.schema, $defs: document.definitions }) as ZodObject
  return zod.shape
}

const isInside = (dir: string, file: string, path: Path.Path) => {
  const relative = path.relative(dir, path.resolve(file))
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

// Runs an agent stage on the user's installed Claude CLI through the Agent SDK. The session is isolated:
// no user settings, skills, plugins, MCP servers or claude.ai connectors; only the stage's tool, plus
// read-only access to the stage's folders. The system prompt is the stage's instructions followed by its
// skills. Cost and the session id are reported through `hooks`, so a rejected attempt can resume the same
// conversation with your note.
export class AgentSession extends Context.Service<AgentSession, {
  run<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks): Effect.Effect<S["Type"], AgentError, S["DecodingServices"]>
}>()("@viral/server/agent-session/agent-session/AgentSession") {
  static readonly layer = Layer.effect(
    AgentSession,
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const skillPack = yield* SkillPack
      const settings = yield* Settings
      const path = yield* Path.Path
      const claudePath = yield* spawner.string(ChildProcess.make("which", ["claude"])).pipe(
        Effect.map(Str.trim),
        Effect.orDie
      )

      const run = Effect.fn("AgentSession.run")(function*<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks) {
        const configured = yield* settings.get(`stage.${task.stage}.model`, Schema.String)
        const model = Option.getOrElse(configured, () => task.defaultModel)
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
                systemPrompt: skillPack.systemPrompt({ prompt: task.instructions, skills: task.skills }),
                tools: readDirs.length > 0 ? ["Read"] : [],
                settingSources: [],
                mcpServers: { viral: server },
                strictMcpConfig: true,
                settings: { disableClaudeAiConnectors: true },
                allowedTools: [task.output.tool, ...helpers.map((h) => h.name)].map((name) => `mcp__viral__${name}`),
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

      return AgentSession.of({ run })
    })
  ).pipe(Layer.provide([NodeServices.layer, SkillPack.layer, Settings.layer]))

  // For tests: answers each task with a saved result instead of calling Claude, so whole pipelines run
  // without spending tokens. The result still goes through the stage's schema.
  static readonly replay = (answer: (task: AgentTask<Schema.Top>) => unknown) =>
    Layer.succeed(AgentSession, AgentSession.of({
      run: Effect.fn("AgentSession.replay")(function*<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks) {
        yield* hooks.recordSession(`replay-${task.stage}`)
        yield* hooks.recordCost({ model: "replay", inputTokens: 0, outputTokens: 0, costUsd: 0 })
        return yield* Schema.decodeUnknownEffect(task.output.schema)(answer(task)).pipe(
          Effect.mapError((error) => new AgentError({ code: "invalid-output", message: error.message }))
        )
      })
    }))
}
