import type { KeyProvider } from "@viral/contracts"
import { type FilePart, generateText, isStepCount, jsonSchema, type LanguageModel, type ModelMessage, type TextPart, tool, type ToolSet } from "ai"
import { Effect, FileSystem, Option, Path, Redacted, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import {
  AgentError,
  type AgentHooks,
  type AgentRun,
  type AgentTask,
  type AgentTool,
  agentTool,
  outputMismatch,
  redactSecrets,
  toolAnswer,
  toolJsonSchema
} from "@viral/provider-core"
import { decodeHistory, encodeHistory, historyFiles } from "./ai-sdk-history.ts"
import {
  type ImageReader,
  isImageFile,
  MAX_IMAGES_PER_RESULT,
  MAX_RUN_IMAGES,
  type ModelImage,
  rawImageReader,
  stepMessages,
  type ToolImages,
  toolOutput
} from "./ai-sdk-images.ts"
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
  // reads an image for a model, downscaled (the app's); without one, an image's own bytes are sent
  readonly readImage?: ImageReader
}

// the overview contact sheets of a long video are about 8; more than this is a mistake, not a brief
const MAX_BRIEF_IMAGES = 12

// Said after the stage's own instructions when it has images to look at: the instructions say "Read" a file, which a
// model API can't do.
const IMAGES_NOTE = "\n\n## Images here\n\nYou can't open files yourself in this session. The images in the brief are attached to it, " +
  "and the images a tool draws come back with its result (each labelled with its file). To look at any other image file " +
  "the brief or a tool names (a single frame, an earlier sheet), call view_image with its path."

const ViewImage = Schema.Struct({ file: Schema.String })
const StoredHistory = Schema.fromJsonString(Schema.Array(Schema.Unknown))

const fail = (code: string) => (message: string) => new AgentError({ code, message })

// Runs an agent job on a vendor's model with your key, through the AI SDK (Anthropic, OpenAI, Google, OpenRouter,
// or any model behind the Vercel AI Gateway): the same instructions and skills as the CLI, the stage's output tool
// with the same JSON Schema (the run stops when it's called, and the result is decoded with the same Effect
// Schema), and the stage's helper tools. Instead of reading files, the images in the stage's folders are attached
// to the brief, the images its helper tools draw come back as image content, and view_image shows any other
// (ai-sdk-images.ts). The conversation is stored under `sessionsDir`, so a fix round or a rejection continues it,
// like a CLI session. Cost is what the service reports (the gateway, OpenRouter) or tokens × Viral's prices.
export const makeAiSdkProvider = Effect.fn("makeAiSdkProvider")(function*(options: AiSdkOptions) {
  const random = yield* SecureRandom.SecureRandom
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const sessionsDir = options.sessionsDir
  const vendor = VENDORS[options.provider]
  const SESSION_PREFIX = vendor.sessionPrefix
  const languageModel = options.languageModel ?? ((modelId: string, apiKey: string) => vendor.model(modelId, apiKey, options.baseUrl))
  const readImage = options.readImage ?? (yield* rawImageReader())

  const sessionFile = (id: string) => path.join(sessionsDir, `${id}.json`)

  // The images directly inside the stage's folders (contact sheets), each with its file name as a label.
  const briefImages = Effect.fn("AiSdk.briefImages")(function*(dirs: ReadonlyArray<string>, fileOf: Map<unknown, string>) {
    const files: Array<string> = []
    for (const dir of dirs) {
      const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): Array<string> => []))
      for (const name of [...names].sort()) {
        if (isImageFile(name)) files.push(path.join(dir, name))
      }
    }
    const parts: Array<TextPart | FilePart> = []
    for (const file of files.slice(0, MAX_BRIEF_IMAGES)) {
      const image = yield* readImage(file)
      if (Option.isNone(image)) continue
      fileOf.set(image.value.bytes, file)
      parts.push({ type: "text", text: `Image: ${file}` })
      parts.push({ type: "file", mediaType: image.value.mediaType, filename: file, data: { type: "data", data: image.value.bytes } })
    }
    return parts
  })

  // a stored conversation, with its images read again (and remembered, so saving it again keeps them)
  const loadHistory = Effect.fn("AiSdk.loadHistory")(function*(id: string, fileOf: Map<unknown, string>) {
    const json = yield* fs.readFileString(sessionFile(id)).pipe(Effect.mapError((e) => fail("session")(`can't resume ${id}: ${e.message}`)))
    const stored = yield* Schema.decodeEffect(StoredHistory)(json).pipe(Effect.mapError((e) => fail("session")(e.message)))
    const images = new Map<string, Uint8Array>()
    for (const file of historyFiles(stored)) {
      const image = yield* readImage(file)
      if (Option.isSome(image)) {
        images.set(file, image.value.bytes)
        fileOf.set(image.value.bytes, file)
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
    const history = resuming ? yield* loadHistory(sessionId, fileOf) : []
    yield* hooks.recordSession(`${SESSION_PREFIX}${sessionId}`)
    const images = resuming ? [] : yield* briefImages(task.readDirs ?? [], fileOf)
    const user: ModelMessage = {
      role: "user",
      content: [{ type: "text", text: task.message }, ...images],
      ...(cache !== undefined && !resuming ? { providerOptions: cache } : {})
    }
    const messages = [...history, user]

    const services = yield* Effect.context<S["DecodingServices"]>()
    const readDirs = (task.readDirs ?? []).map((dir) => path.resolve(dir))
    // A helper tool's images, read and capped: a few per result, a few dozen per run; the rest are named in its text.
    let attached = 0
    const withImages = Effect.fn("AiSdk.withImages")(function*(text: string, files: ReadonlyArray<string>) {
      const images: Array<ModelImage> = []
      const left: Array<string> = []
      for (const file of files) {
        if (images.length >= MAX_IMAGES_PER_RESULT || attached >= MAX_RUN_IMAGES) {
          left.push(file)
          continue
        }
        const image = yield* readImage(file)
        if (Option.isNone(image)) {
          left.push(file)
          continue
        }
        images.push(image.value)
        attached++
      }
      const note = left.length === 0
        ? ""
        : attached >= MAX_RUN_IMAGES
        ? `\n\n(This run has seen ${MAX_RUN_IMAGES} images, the most it can; ${left.length} more weren't attached. Decide from what you've seen.)`
        : `\n\n(Not attached: ${left.join(", ")}. Call view_image for one you need.)`
      return { text: text + note, images } satisfies ToolImages
    })
    // view_image: any image inside the stage's folders, for the files a CLI would Read
    const viewImage: AgentTool = agentTool({
      name: "view_image",
      description: "Look at one image file the brief or a tool named (a contact sheet, a frame, a preview). Returns the image.",
      schema: ViewImage,
      run: ({ file }) =>
        Effect.sync(() => {
          const resolved = path.resolve(file)
          if (!isImageFile(resolved)) return toolAnswer(`${file} isn't an image (png, jpg or webp)`)
          if (!readDirs.some((dir) => resolved.startsWith(dir + path.sep))) return toolAnswer(`${file} isn't one of this step's files`)
          return toolAnswer(`Here is ${file}.`, [resolved])
        })
    })
    const helpers = [...(task.tools ?? []), ...(readDirs.length > 0 ? [viewImage] : [])]
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
      ...Object.fromEntries(helpers.map((helper) => [
        helper.name,
        tool({
          description: helper.description,
          inputSchema: jsonSchema(toolJsonSchema(helper.schema)),
          execute: (input: unknown) =>
            Effect.runPromiseWith(services)(helper.run(input).pipe(Effect.flatMap((answer) => withImages(answer.text, answer.images)))),
          // the images go to the model as image content, not as paths it can't open
          toModelOutput: ({ output }) => toolOutput(output)
        })
      ]))
    }

    const fullSystem = readDirs.length > 0 ? system + IMAGES_NOTE : system
    const result = yield* Effect.tryPromise({
      try: (signal) =>
        generateText({
          model: languageModel(model, Redacted.value(key.value)),
          instructions: cache !== undefined ? { role: "system", content: fullSystem, providerOptions: cache } : fullSystem,
          messages,
          tools,
          // each step sees the whole conversation with only the newest tool images, placed where the vendor takes them
          prepareStep: ({ initialMessages, responseMessages }) => ({
            messages: stepMessages([...initialMessages, ...responseMessages], vendor.toolImages)
          }),
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
