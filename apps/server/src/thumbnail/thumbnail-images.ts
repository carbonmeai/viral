import { NodeServices } from "@effect/platform-node"
import {
  type GeneratedThumbnail,
  type Source,
  type SourcePiece,
  THUMBNAIL_IMAGE_CREDITS,
  THUMBNAIL_IMAGE_MODEL,
  THUMBNAIL_OPTIONS,
  THUMBNAIL_USD_PER_CREDIT,
  type ThumbnailDesign,
  type ThumbnailOption,
  type VoiceError
} from "@viral/contracts"
import { createGateway } from "@ai-sdk/gateway"
import { generateImage } from "ai"
import { Config, Context, Effect, FileSystem, Layer, Option, Path, Redacted, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { sourceLabel } from "../projects/source-context.ts"
import { Secrets } from "../secrets/secrets.ts"
import { SourcePieces } from "../sources/source-pieces.ts"
import { UsageRecords } from "../usage/usage-records.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { buildImagePrompt, designInputs } from "./thumbnail-design.ts"

export class ThumbnailImageError extends Schema.TaggedError<ThumbnailImageError>()("ThumbnailImageError", {
  code: Schema.String,
  message: Schema.String
}) {}

// One of the short's videos a design's frames come from, by its position (V1 = 0).
export interface RoundVideo {
  readonly index: number
  readonly path: string
  readonly source: Source
}

// A round as made: everything the stored GeneratedThumbnail needs except the agent's verdict, with files in `dir`.
export type Round = Omit<GeneratedThumbnail, "recommended" | "chosen">

// a piece may start or end a few milliseconds off (as source_pieces.py allows)
const SLACK = 0.02
const W = 1080
const H = 1920

// the piece covering a second of a scanned video (its file and the time in it), else the video itself
export const frameFile = (video: string, pieces: ReadonlyArray<SourcePiece>, t: number) => {
  const piece = pieces.find((p) => p.start <= t + SLACK && p.end >= t + 0.04 - SLACK)
  return piece === undefined ? { file: video, at: t } : { file: piece.path, at: Math.max(0, t - piece.start) }
}

// In plain words, why an option wasn't made.
export const optionFailure = (error: VoiceError) =>
  error.code === "moderated"
    ? `The image model refused it: ${error.message}`
    : error.code === "timeout"
    ? "The image model took too long."
    : error.message

// Real public figures are blocked by the image model; said when every option was refused by moderation.
const CELEBRITY_HINT = " Image models block real public figures; if this person is one, ask for another approach in a note."

// Which service makes the images: ElevenLabs' Image & Video API (the skill's way; needs a Pro plan), or the Vercel
// AI Gateway, which serves the same model.
export type ImageService = "elevenlabs" | "ai-gateway"
const SERVICE_NAMES: Record<ImageService, string> = { elevenlabs: "ElevenLabs", "ai-gateway": "AI Gateway" }
export const GATEWAY_IMAGE_MODEL = `openai/${THUMBNAIL_IMAGE_MODEL}`
// the Gateway's listed price for the model (USD per token), for when a call reports tokens but no cost
const GATEWAY_USD_PER_TOKEN = { input: 5 / 1e6, output: 30 / 1e6 }
// what the Gateway reports a call cost (as for its language models); with your own provider key it's marketCost
const Usd = Schema.Union([Schema.Finite, Schema.NumberFromString])
const GatewayCost = Schema.Struct({ gateway: Schema.Struct({ cost: Usd, marketCost: Schema.optional(Usd) }) })

// An image made, and its bill.
interface Made {
  readonly data: Uint8Array
  readonly mimeType: string
  readonly credits: number | null
  readonly costUsd: number | null
  readonly inputTokens: number | null
  readonly outputTokens: number | null
}
// Why an option wasn't made: a code ("plan", "moderated", "timeout"…) and the plain words shown at the gate.
interface Refusal {
  readonly code: string
  readonly message: string
}

// The Gateway's error, in plain words: a content refusal says so.
const gatewayFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /moderat|safety|policy|content|violate/i.test(message) ? `The image model refused it: ${message}` : `The AI Gateway couldn't make it: ${message}`
}

// Whether the AI Gateway may make thumbnails: on in the app (main.ts provides it), off by default, so a test that runs
// the thumbnail stage never reaches a real account with a Gateway key from .env.
export const GatewayImages = Context.Reference<{ readonly enabled: boolean }>("@viral/server/thumbnail/thumbnail-images/GatewayImages", {
  defaultValue: () => ({ enabled: false })
})

// Makes a round of AI thumbnails (the short-thumbnail skill): the design's real frames are taken from the videos
// (from their 1080p pieces where a video was read from a scan), numbered in the prompt, and sent to the image model
// for three 9:16 options at once; each is scaled to 1080×1920. The round's credits go to Settings › Usage (step
// "thumbnail", billed) the moment it's made. A design naming a real public figure isn't sent at all.
export class ThumbnailImages extends Context.Service<ThumbnailImages, {
  // whether an image key is set: ElevenLabs or the AI Gateway (else the stage draws its basic thumbnail)
  readonly ready: Effect.Effect<boolean>
  // the design's frames as jpgs in `dir` (input-1-reaction.jpg…), in prompt order
  frames(design: ThumbnailDesign, videos: ReadonlyArray<RoundVideo>, dir: string, progress: (pct: number | null, message?: string) => Effect.Effect<void>): Effect.Effect<Round["inputs"], ThumbnailImageError>
  make(input: {
    readonly design: ThumbnailDesign
    readonly videos: ReadonlyArray<RoundVideo>
    readonly dir: string
    readonly projectId: string | null
    readonly progress: (pct: number | null, message?: string) => Effect.Effect<void>
  }): Effect.Effect<Round, ThumbnailImageError>
}>()("@viral/server/thumbnail/thumbnail-images/ThumbnailImages") {
  static readonly layer = Layer.effect(
    ThumbnailImages,
    Effect.gen(function*() {
      const eleven = yield* ElevenLabs
      const secrets = yield* Secrets
      const usage = yield* UsageRecords
      const sourcePieces = yield* SourcePieces
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const fail = (code: string) => (error: { readonly message: string }) => new ThumbnailImageError({ code, message: error.message })

      const ffmpeg = Effect.fn("ThumbnailImages.ffmpeg")(function*(args: ReadonlyArray<string>, out: string) {
        const exit = yield* spawner.exitCode(ChildProcess.make("ffmpeg", ["-y", "-loglevel", "error", ...args, out])).pipe(
          Effect.mapError(fail("ffmpeg"))
        )
        if (exit !== ChildProcessSpawner.ExitCode(0) || !(yield* fs.exists(out).pipe(Effect.orElseSucceed(() => false)))) {
          return yield* new ThumbnailImageError({ code: "ffmpeg", message: `ffmpeg couldn't write ${path.basename(out)}` })
        }
      })

      const frames = Effect.fn("ThumbnailImages.frames")(function*(
        design: ThumbnailDesign,
        videos: ReadonlyArray<RoundVideo>,
        dir: string,
        progress: (pct: number | null, message?: string) => Effect.Effect<void>
      ) {
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(fail("write")))
        const inputs = designInputs(design)
        // a scanned video's frames come from 1080p pieces around each second
        const footage = yield* sourcePieces.forShort(
          videos.flatMap((v) => {
            const ranges = inputs.filter((i) => (i.source ?? 0) === v.index).map((i) => ({ start: Math.max(0, i.src - 0.5), end: i.src + 0.5 }))
            return ranges.length === 0 ? [] : [{ index: v.index, source: v.source, ranges }]
          }),
          progress
        )
        const problems = footage.videos.flatMap((v) => v.problem === null ? [] : [`${sourceLabel(v.index)}: ${v.problem}`])
        if (problems.length > 0) yield* progress(null, `some frames come from the 480p reading copy (${problems.join("; ")})`)
        return yield* Effect.forEach(inputs, (input, i) =>
          Effect.gen(function*() {
            const video = videos.find((v) => v.index === (input.source ?? 0))
            if (video === undefined) return yield* new ThumbnailImageError({ code: "video", message: `${sourceLabel(input.source ?? 0)} isn't one of this short's videos` })
            const { at, file } = frameFile(video.path, footage.piecesBySource?.[String(video.index)] ?? [], input.src)
            const name = `input-${i + 1}-${input.role}.jpg`
            yield* ffmpeg(["-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-q:v", "2", "-f", "image2"], path.join(dir, name))
            return { file: name, role: input.role, src: input.src, ...(input.source === undefined ? {} : { source: input.source }) }
          }), { concurrency: 4 })
      })

      // the AI Gateway: the same model, for a key without ElevenLabs' Pro plan; AI_GATEWAY_API_URL moves it (tests)
      const gatewayUrl = yield* Config.option(Config.String("AI_GATEWAY_API_URL")).pipe(Effect.orDie)
      const gatewayOn = (yield* GatewayImages).enabled
      const gatewayReady = gatewayOn ? Effect.map(secrets.get("gateway"), Option.isSome) : Effect.succeed(false)
      // ElevenLabs refused images for the plan once: the Gateway is used from then on, while the server runs
      let elevenPlanRefused = false

      // One image from a service: its bytes, and its bill (ElevenLabs credits, or the Gateway's dollars).
      const elevenImage = (prompt: string, images: ReadonlyArray<Uint8Array>) =>
        eleven.image({
          model: THUMBNAIL_IMAGE_MODEL,
          prompt,
          images: images.map((data) => ({ data, mimeType: "image/jpeg" })),
          aspectRatio: "9:16",
          resolution: "2K",
          quality: "high"
        }).pipe(
          Effect.map((made): Made => ({ data: made.data, mimeType: made.mimeType, credits: made.credits ?? THUMBNAIL_IMAGE_CREDITS, costUsd: null, inputTokens: null, outputTokens: null })),
          Effect.mapError((error): Refusal => ({ code: error.code, message: optionFailure(error) }))
        )

      const gatewayImage = Effect.fn("ThumbnailImages.gatewayImage")(function*(prompt: string, images: ReadonlyArray<Uint8Array>) {
        const key = yield* secrets.get("gateway")
        if (Option.isNone(key)) return yield* Effect.fail<Refusal>({ code: "no-key", message: "There's no AI Gateway key." })
        const model = createGateway({
          apiKey: Redacted.value(key.value),
          ...(Option.isSome(gatewayUrl) ? { baseURL: `${gatewayUrl.value.replace(/\/+$/, "")}/v3/ai` } : {})
        }).imageModel(GATEWAY_IMAGE_MODEL)
        const result = yield* Effect.tryPromise({
          try: (signal) =>
            generateImage({
              model,
              prompt: { text: prompt, images: [...images] },
              n: 1,
              aspectRatio: "9:16",
              providerOptions: { openai: { quality: "high" } },
              maxRetries: 1,
              abortSignal: signal
            }),
          catch: (error): Refusal => ({ code: "gateway", message: gatewayFailure(error) })
        }).pipe(
          Effect.timeoutOrElse({ duration: "6 minutes", orElse: () => Effect.fail<Refusal>({ code: "timeout", message: "The image model took too long." }) })
        )
        const reported = Schema.decodeUnknownOption(GatewayCost)(result.providerMetadata)
        const inputTokens = result.usage.inputTokens ?? null
        const outputTokens = result.usage.outputTokens ?? null
        const costUsd = Option.isSome(reported)
          ? Math.max(Number(reported.value.gateway.cost) || 0, Number(reported.value.gateway.marketCost ?? 0) || 0)
          : inputTokens === null && outputTokens === null
          ? null
          : ((inputTokens ?? 0) * GATEWAY_USD_PER_TOKEN.input) + ((outputTokens ?? 0) * GATEWAY_USD_PER_TOKEN.output)
        return { data: result.image.uint8Array, mimeType: result.image.mediaType, credits: null, costUsd, inputTokens, outputTokens } satisfies Made
      })

      const option = Effect.fn("ThumbnailImages.option")(function*(service: ImageService, n: number, prompt: string, images: ReadonlyArray<Uint8Array>, dir: string) {
        const made = yield* (service === "elevenlabs" ? elevenImage(prompt, images) : gatewayImage(prompt, images))
        const raw = path.join(dir, `option-${n}-original.${made.mimeType === "image/jpeg" ? "jpg" : made.mimeType === "image/webp" ? "webp" : "png"}`)
        yield* fs.writeFile(raw, made.data).pipe(Effect.mapError((e): Refusal => ({ code: "write", message: e.message })))
        const name = `option-${n}.jpg`
        yield* ffmpeg(["-i", raw, "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`, "-q:v", "2"], path.join(dir, name)).pipe(
          Effect.mapError((e): Refusal => ({ code: "ffmpeg", message: e.message }))
        )
        return { ...made, image: name }
      })

      const round = (service: ImageService, prompt: string, images: ReadonlyArray<Uint8Array>, dir: string) =>
        Effect.forEach(
          Array.from({ length: THUMBNAIL_OPTIONS }, (_, i) => i + 1),
          (n) =>
            option(service, n, prompt, images, dir).pipe(
              Effect.map((made) => ({ made, failure: null as Refusal | null })),
              Effect.catch((failure: Refusal) => Effect.succeed({ made: null, failure }))
            ),
          { concurrency: THUMBNAIL_OPTIONS }
        )

      // ElevenLabs first (Decision 7), unless its plan refused images; else the AI Gateway
      const pickService = Effect.gen(function*() {
        if (!elevenPlanRefused && (yield* eleven.imagesReady)) return "elevenlabs" as const
        return (yield* gatewayReady) ? "ai-gateway" as const : null
      })

      const make = Effect.fn("ThumbnailImages.make")(function*(input: {
        readonly design: ThumbnailDesign
        readonly videos: ReadonlyArray<RoundVideo>
        readonly dir: string
        readonly projectId: string | null
        readonly progress: (pct: number | null, message?: string) => Effect.Effect<void>
      }) {
        const inputs = yield* frames(input.design, input.videos, input.dir, input.progress)
        const prompt = buildImagePrompt(input.design)
        const base = { design: input.design, model: THUMBNAIL_IMAGE_MODEL, prompt, inputs }
        if (input.design.celebrity !== null && input.design.celebrity.trim() !== "") {
          return {
            ...base,
            options: [],
            credits: 0,
            heldBack: `${input.design.celebrity.trim()} is a real public figure, and image models block real celebrities, so their face wasn't sent. ` +
              "Ask for another round with a note (\"try anyway\", or another approach), or keep the basic thumbnail."
          } satisfies Round
        }
        let service = yield* pickService
        if (service === null) return yield* new ThumbnailImageError({ code: "no-key", message: "add an ElevenLabs or AI Gateway key for AI thumbnails" })
        const images = yield* Effect.forEach(inputs, (i) => fs.readFile(path.join(input.dir, i.file)).pipe(Effect.mapError(fail("read"))))
        const asking = (s: ImageService) => input.progress(null, `asking ${THUMBNAIL_IMAGE_MODEL} (${SERVICE_NAMES[s]}) for ${THUMBNAIL_OPTIONS} thumbnails from ${inputs.length} real frames`)
        yield* asking(service)
        let results = yield* round(service, prompt, images, input.dir)
        if (service === "elevenlabs" && results.every((r) => r.failure?.code === "plan") && (yield* gatewayReady)) {
          elevenPlanRefused = true
          service = "ai-gateway"
          yield* input.progress(null, "your ElevenLabs plan can't make images, so the AI Gateway makes them")
          yield* asking(service)
          results = yield* round(service, prompt, images, input.dir)
        }
        const made = results.flatMap((r) => r.made === null ? [] : [r.made])
        const credits = made.reduce((n, m) => n + (m.credits ?? 0), 0)
        if (made.length > 0) {
          if (service === "elevenlabs") {
            const plan = yield* eleven.plan
            const usdPerCredit = plan._tag === "Plan" && plan.usdPerCharacter !== null ? plan.usdPerCharacter : THUMBNAIL_USD_PER_CREDIT
            yield* usage.record({
              projectId: input.projectId,
              step: "thumbnail",
              provider: "elevenlabs",
              model: THUMBNAIL_IMAGE_MODEL,
              billing: "billed",
              characters: credits,
              costUsd: credits * usdPerCredit,
              costBasis: "estimate"
            })
          } else {
            const costs = made.map((m) => m.costUsd)
            const known = costs.every((c) => c !== null)
            yield* usage.record({
              projectId: input.projectId,
              step: "thumbnail",
              provider: "ai-gateway",
              model: GATEWAY_IMAGE_MODEL,
              billing: "billed",
              inputTokens: made.reduce((n, m) => n + (m.inputTokens ?? 0), 0),
              outputTokens: made.reduce((n, m) => n + (m.outputTokens ?? 0), 0),
              costUsd: known ? costs.reduce<number>((n, c) => n + (c ?? 0), 0) : null,
              costBasis: known ? "reported" : "unknown"
            })
          }
        }
        const costUsd = service === "ai-gateway" ? made.reduce<number | null>((n, m) => n === null || m.costUsd === null ? null : n + m.costUsd, 0) : null
        const failures = results.flatMap((r) => r.failure === null ? [] : [r.failure])
        const hint = made.length === 0 && failures.length > 0 && failures.every((f) => f.code === "moderated" || /terms|violate/i.test(f.message)) ? CELEBRITY_HINT : ""
        const options = results.map((r): ThumbnailOption => ({
          image: r.made?.image ?? null,
          failure: r.failure === null ? null : `${r.failure.message}${hint}`,
          faces: null,
          note: null
        }))
        return { ...base, options, credits, service, ...(costUsd === null ? {} : { costUsd }) } satisfies Round
      })

      const ready = Effect.map(pickService, (service) => service !== null)
      return ThumbnailImages.of({ ready, frames, make })
    })
  ).pipe(Layer.provide([UsageRecords.layer, SourcePieces.layer, Secrets.layer, NodeServices.layer]))
}
