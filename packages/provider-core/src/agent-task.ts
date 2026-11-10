import { AgentProvider } from "@viral/contracts"
import { Effect, type Redacted, Schema } from "effect"
import { fromJSONSchema, type ZodObject } from "zod"

// `code`: "session" (the CLI, SDK or gateway failed), "no-output" (the agent never called its tool),
// "invalid-output" (it called it with something the schema rejects), "ended" (the session ended with an error),
// "no-key" / "no-model" (a key provider isn't set up for this stage).
export class AgentError extends Schema.TaggedError<AgentError>()("AgentError", {
  code: Schema.String,
  message: Schema.String
}) {}

// What a helper tool answers: text for the agent, plus the image files it drew that the agent should look at
// (a detail sheet, a preview). A CLI reads the files named in the text itself; the AI SDK providers attach `images`
// to the tool's result, since a model API can't open a file.
export interface ToolAnswer {
  readonly text: string
  readonly images: ReadonlyArray<string>
}

export const toolAnswer = (text: string, images: ReadonlyArray<string> = []): ToolAnswer => ({ text, images })

// A helper tool a stage offers besides its output tool (e.g. a detail contact sheet). Its result is text for the
// agent, with any images it drew; a bad input comes back as text too, so the agent can correct it.
export interface AgentTool {
  readonly name: string
  readonly description: string
  readonly schema: Schema.Top
  run(input: unknown): Effect.Effect<ToolAnswer>
}

export const agentTool = <A, I>(spec: {
  readonly name: string
  readonly description: string
  readonly schema: Schema.Codec<A, I>
  // plain text, or text with the images to show
  readonly run: (input: A) => Effect.Effect<string | ToolAnswer>
}): AgentTool => ({
  name: spec.name,
  description: spec.description,
  schema: spec.schema,
  run: (input) =>
    Schema.decodeUnknownEffect(spec.schema)(input).pipe(
      Effect.matchEffect({ onFailure: (error) => Effect.succeed(`invalid input: ${error.message}`), onSuccess: spec.run }),
      Effect.map((answer) => typeof answer === "string" ? toolAnswer(answer) : answer)
    )
})

// Which provider runs an agent job, and on which model. The Claude CLI is the default; the others are chosen
// per step in Settings › Agents (or by an eval).
export const AgentProviderName = AgentProvider
export type AgentProviderName = AgentProvider
export interface AgentRoute {
  readonly provider: AgentProviderName
  // a CLI alias or id ("haiku"; null = the CLI's default), or a key provider's model id ("claude-haiku-5-5",
  // "openai/gpt-6-luna" on OpenRouter or the gateway)
  readonly model: string | null
}

// One agent job: a stage asks for one structured result. `Skill` is the app's skill names; providers never see
// them, they get the system prompt the app built from them.
export interface AgentTask<S extends Schema.Top, Skill extends string = string> {
  readonly stage: string
  // the stage's job and tool contract; the domain knowledge comes from `skills`
  readonly instructions: string
  readonly skills: ReadonlyArray<Skill>
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
  // the provider that holds that conversation, when known: a run routed elsewhere can't continue it
  readonly resumeProvider?: string | null
  // run on this provider and model regardless of the stage's settings (evals)
  readonly route?: AgentRoute
}

// What one agent job cost. The provider and billing are filled in by AgentSession, which knows the route.
// `costUsd` is null when the model has no known price (its tokens still count); `costBasis` says whether the
// service reported the cost or it was estimated from tokens (CLIs leave it out: theirs is reported).
export interface AgentCost {
  readonly model: string | null
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number | null
  readonly costBasis?: "reported" | "estimate" | "unknown" | null
  readonly provider?: string | null
  readonly billing?: "billed" | "subscription" | null
}

export interface AgentHooks {
  progress(pct: number | null, message?: string): Effect.Effect<void>
  recordCost(cost: AgentCost): Effect.Effect<void>
  recordSession(sessionId: string): Effect.Effect<void>
}

// How a signed-in CLI runs this time (its key setup in Settings › Accounts), resolved by the app for one run and
// handed only to that run's process. Nothing here ever goes into the server's own environment.
export interface CliEnvironment {
  // variables added over the server's environment ("" sets one empty); secrets already read from the store
  readonly env: Readonly<Record<string, string>>
  // Codex: sign in with this API key instead of your login, in its own folder (CODEX_HOME), keeping the key in
  // memory only; null on your sign-in
  readonly apiKey: { readonly key: Redacted.Redacted<string>; readonly home: string } | null
}

export const NO_CLI_ENVIRONMENT: CliEnvironment = { env: {}, apiKey: null }

// One provider's way of running a job on a model. `system` is the full system prompt (the stage's instructions
// followed by its skills), built by the app. `cli` is a CLI's environment for this run (the key providers ignore it).
export type AgentRun = <S extends Schema.Top>(
  task: AgentTask<S>,
  hooks: AgentHooks,
  model: string | null,
  system: string,
  cli?: CliEnvironment
) => Effect.Effect<S["Type"], AgentError, S["DecodingServices"]>

// The result of the output tool once the schema accepts it, or the message that sends a mismatch back to the
// model so it can fix it (every provider answers the output tool this way).
export const outputMismatch = (tool: string, error: string) =>
  `That doesn't match the expected format:\n${error}\n\nFix it and call ${tool} again with the whole result.`

// The JSON Schema of an Effect Schema, as one document with its definitions inline: the shape every provider's
// tool input takes. One schema serves both as the tool's input contract for the model and as the server check.
export const toolJsonSchema = (schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(schema)
  return { ...document.schema, $defs: document.definitions }
}

// The same, as the zod shape the Claude Agent SDK's tool() takes.
export const toolShape = (schema: Schema.Top) => (fromJSONSchema(toolJsonSchema(schema)) as ZodObject).shape
