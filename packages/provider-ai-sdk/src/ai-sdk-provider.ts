import type { KeyProvider } from "@viral/contracts"
import { generateText, type ImagePart, isStepCount, jsonSchema, type LanguageModel, type ModelMessage, type TextPart, tool, type ToolSet } from "ai"
import { Effect, FileSystem, Option, Path, Redacted, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { AgentError, type AgentHooks, type AgentRun, type AgentTask, outputMismatch, redactSecrets, toolJsonSchema } from "@viral/provider-core"
import { decodeHistory, encodeHistory } from "./ai-sdk-history.ts"
import { VENDORS } from "./ai-sdk-vendors.ts"

export interface AiSdkOptions {
  // which vendor: Anthropic, OpenAI, Google, OpenRouter or the AI Gateway
  readonly provider: KeyProvider
  // the vendor's key, read when a job runs (none = the job fails with "no-key")
  readonly apiKey: Effect.Effect<Option.Option<Redacted.Redacted<string>>>
  // where conversations are kept between attempts
  readonly sessionsDir: string
  // the service's address (no path), when it isn't the real one: tests point it at a fake server
  readonly baseUrl?: string
  // the language model behind an id; tests pass a mock
  readonly languageModel?: (modelId: string, apiKey: string) => LanguageModel
}

// Anthropic models cache a marked prefix (the system prompt, then the brief) for 5 minutes, so fix rounds and
// resumes re-read it cheaply (directly, on the gateway and on OpenRouter); OpenAI and Google cache repeated
// prefixes on their own.
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }
// the overview contact sheets of a long video are about 8; more than this is a mistake, not a brief
const MAX_BRIEF_IMAGES = 12
const StoredHistory = Schema.fromJsonString(Schema.Array(Schema.Unknown))

const fail = (code: string) => (message: string) => new AgentError({ code, message })

// Runs an agent job on a vendor's model with your key, through the AI SDK (Anthropic, OpenAI, Google, OpenRouter,
// or any model behind the Vercel AI Gateway): the same instructions and skills as the CLI, the stage's output tool
// with the same JSON Schema (the run stops when it's called, and the result is decoded with the same Effect
// Schema), and the stage's helper tools. Instead of reading files, the images in the stage's folders are attached
// to the brief. The conversation is stored under `sessionsDir`, so a fix round or a rejection continues it, like
// a CLI session. Cost is what the service reports (the gateway, OpenRouter) or tokens × Viral's prices.
export const makeAiSdkProvider = Effect.fn("makeAiSdkProvider")(function*(options: AiSdkOptions) {
  const random = yield* SecureRandom.SecureRandom
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const sessionsDir = options.sessionsDir
  const vendor = VENDORS[options.provider]
  const SESSION_PREFIX = vendor.sessionPrefix
  const languageModel = options.languageModel ?? ((modelId: string, apiKey: string) => vendor.model(modelId, apiKey, options.baseUrl))

  const sessionFile = (id: string) => path.join(sessionsDir, `${id}.json`)

  // The images directly inside the stage's folders (contact sheets), each with its file name as a label.
  const briefImages = Effect.fn("AiSdk.briefImages")(function*(dirs: ReadonlyArray<string>, fileOf: Map<unknown, string>) {
    const files: Array<string> = []
    for (const dir of dirs) {
      const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): Array<string> => []))
      for (const name of [...names].sort()) {
        if (IMAGE_TYPES[path.extname(name).toLowerCase()] !== undefined) files.push(path.join(dir, name))
      }
    }
    const parts: Array<TextPart | ImagePart> = []
    for (const file of files.slice(0, MAX_BRIEF_IMAGES)) {
      const bytes = yield* fs.readFile(file).pipe(Effect.option)
      if (Option.isNone(bytes)) continue
      fileOf.set(bytes.value, file)
      parts.push({ type: "text", text: `Image: ${file}` })
      parts.push({ type: "image", image: bytes.value, mediaType: IMAGE_TYPES[path.extname(file).toLowerCase()] ?? "image/png" })
    }
    return parts
  })

  const loadHistory = Effect.fn("AiSdk.loadHistory")(function*(id: string) {
    const json = yield* fs.readFileString(sessionFile(id)).pipe(Effect.mapError((e) => fail("session")(`can't resume ${id}: ${e.message}`)))
    const stored = yield* Schema.decodeEffect(StoredHistory)(json).pipe(Effect.mapError((e) => fail("session")(e.message)))
    const images = new Map<string, Uint8Array>()
    for (const message of stored) {
      const content = typeof message === "object" && message !== null && "content" in message && Array.isArray(message.content) ? message.content : []
      for (const part of content) {
        if (typeof part === "object" && part !== null && "file" in part && typeof part.file === "string") {
          const bytes = yield* fs.readFile(part.file).pipe(Effect.option)
          if (Option.isSome(bytes)) images.set(part.file, bytes.value)
        }
      }
    }
    return decodeHistory(stored, (file) => images.get(file))
  })

  const saveHistory = Effect.fn("AiSdk.saveHistory")(function*(id: string, messages: ReadonlyArray<ModelMessage>, fileOf: Map<unknown, string>) {
    const json = yield* Schema.encodeEffect(StoredHistory)(encodeHistory(messages, (image) => fileOf.get(image)))
    yield* fs.makeDirectory(sessionsDir, { recursive: true })
    yield* fs.writeFileString(sessionFile(id), json)
  }, Effect.orElseSucceed(() => undefined))

  const run: AgentRun = Effect.fn("AiSdk.run")(function*<S extends Schema.Top>(
    task: AgentTask<S>,
    hooks: AgentHooks,
    model: string | null,
    system: string
  ) {
    if (model === null) {
      return yield* fail("no-model")(`choose a ${vendor.name} model for the ${task.stage} stage (e.g. ${vendor.modelExample})`)
    }
    const key = yield* options.apiKey
    if (Option.isNone(key)) {
      return yield* fail("no-key")(vendor.keyHint)
    }
    const cache = vendor.cache(model)
    const fileOf = new Map<unknown, string>()

    // a resumed run continues its stored conversation; a new one starts with the brief and its images
    const resuming = task.resumeSession?.startsWith(SESSION_PREFIX) === true
    const sessionId = resuming ? task.resumeSession!.slice(SESSION_PREFIX.length) : yield* random.uuidV7()
    const history = resuming ? yield* loadHistory(sessionId) : []
    yield* hooks.recordSession(`${SESSION_PREFIX}${sessionId}`)
    const images = resuming ? [] : yield* briefImages(task.readDirs ?? [], fileOf)
    const user: ModelMessage = {
      role: "user",
      content: [{ type: "text", text: task.message }, ...images],
      ...(cache !== undefined && !resuming ? { providerOptions: cache } : {})
    }
    const messages = [...history, user]

    const services = yield* Effect.context<S["DecodingServices"]>()
    // The output tool checks its input against the stage's schema: a match is the result and ends the run; a
    // mismatch goes back to the model as the tool's answer, so it can fix it and call again (as on the CLI).
    let accepted: Option.Option<{ readonly value: S["Type"]; readonly input: unknown }> = Option.none()
    const decodeOutput = Schema.decodeUnknownEffect(task.output.schema)
    const tools: ToolSet = {
      [task.output.tool]: tool({
        description: task.output.description,
        inputSchema: jsonSchema(toolJsonSchema(task.output.schema)),
        execute: (input: unknown) =>
          Effect.runPromiseWith(services)(decodeOutput(input).pipe(Effect.match({
            onFailure: (error) => outputMismatch(task.output.tool, error.message),
            onSuccess: (value) => {
              accepted = Option.some({ value, input })
              return "Received."
            }
          })))
      }),
      ...Object.fromEntries((task.tools ?? []).map((helper) => [
        helper.name,
        tool({
          description: helper.description,
          inputSchema: jsonSchema(toolJsonSchema(helper.schema)),
          execute: (input: unknown) => Effect.runPromiseWith(services)(helper.run(input))
        })
      ]))
    }

    const result = yield* Effect.tryPromise({
      try: (signal) =>
        generateText({
          model: languageModel(model, Redacted.value(key.value)),
          instructions: cache !== undefined ? { role: "system", content: system, providerOptions: cache } : system,
          messages,
          tools,
          stopWhen: [() => Option.isSome(accepted), isStepCount(task.maxTurns ?? 8)],
          maxRetries: 2,
          abortSignal: signal,
          onStepFinish: (step) =>
            Effect.runPromiseWith(services)(Effect.all([
              step.text.trim() === "" ? Effect.void : hooks.progress(null, step.text),
              ...step.toolCalls.map((call) => hooks.progress(null, `→ ${call.toolName}`))
            ], { discard: true }))
        }),
      // SDK errors can echo a request's headers back; keys never reach a stage error or a log
      catch: (cause) => fail("session")(redactSecrets(cause instanceof Error ? cause.message : String(cause), [Redacted.value(key.value)]))
    })

    const cost = vendor.cost(model, result.steps, result.totalUsage)
    yield* hooks.recordCost({
      model,
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
      costUsd: cost.costUsd,
      costBasis: cost.basis
    })

    // the output tool answered every call itself, so the stored conversation is already well formed
    yield* saveHistory(sessionId, [...messages, ...result.responseMessages], fileOf)

    if (Option.isSome(accepted)) return accepted.value.value
    const calls = result.steps.flatMap((step) => step.toolCalls).filter((c) => c.toolName === task.output.tool)
    if (calls.length > 0) {
      // it kept calling with output that doesn't match, until the turns ran out
      const last = calls.at(-1)!
      return yield* decodeOutput(last.input).pipe(Effect.mapError((error) => fail("invalid-output")(error.message)))
    }
    return yield* fail("no-output")(`the agent didn't call ${task.output.tool}${result.text.trim() === "" ? "" : `; it said: ${result.text.slice(0, 300)}`}`)
  })

  return run
})
