import { Effect, Schema } from "effect"
import { fromJSONSchema, type ZodObject } from "zod"
import type { SkillName } from "../agent-skills/skill-pack.ts"

// `code`: "session" (the CLI, SDK or gateway failed), "no-output" (the agent never called its tool),
// "invalid-output" (it called it with something the schema rejects), "ended" (the session ended with an error),
// "no-key" / "no-model" (the AI Gateway isn't set up for this stage).
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

// Which provider runs an agent job, and on which model. The Claude CLI is the default; the AI Gateway is an
// experimental second provider, mainly for evals.
export const AgentProviderName = Schema.Literals(["claude-cli", "ai-gateway"])
export type AgentProviderName = typeof AgentProviderName.Type
export interface AgentRoute {
  readonly provider: AgentProviderName
  // a CLI alias or id ("haiku"; null = the CLI's default), or a gateway model id ("openai/gpt-6-luna")
  readonly model: string | null
}

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
  // run on this provider and model regardless of the stage's settings (evals)
  readonly route?: AgentRoute
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

// One provider's way of running a job on a model.
export type AgentRun = <S extends Schema.Top>(
  task: AgentTask<S>,
  hooks: AgentHooks,
  model: string | null
) => Effect.Effect<S["Type"], AgentError, S["DecodingServices"]>

// The JSON Schema of an Effect Schema, as one document with its definitions inline: the shape every provider's
// tool input takes. One schema serves both as the tool's input contract for the model and as the server check.
export const toolJsonSchema = (schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(schema)
  return { ...document.schema, $defs: document.definitions }
}

// The same, as the zod shape the Claude Agent SDK's tool() takes.
export const toolShape = (schema: Schema.Top) => (fromJSONSchema(toolJsonSchema(schema)) as ZodObject).shape
