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
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { sourceLabel } from "../projects/source-context.ts"
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

// Real public figures are blocked by the image model; when every option was refused, say so.
const celebrityHint = (failures: ReadonlyArray<string>) =>
  failures.length > 0 && failures.every((f) => /refused|terms|violate|moderat/i.test(f))
    ? " Image models block real public figures; if this person is one, ask for the basic thumbnail or describe another approach."
    : ""

// Makes a round of AI thumbnails (the short-thumbnail skill): the design's real frames are taken from the videos
// (from their 1080p pieces where a video was read from a scan), numbered in the prompt, and sent to the image model
// for three 9:16 options at once; each is scaled to 1080×1920. The round's credits go to Settings › Usage (step
// "thumbnail", billed) the moment it's made. A design naming a real public figure isn't sent at all.
export class ThumbnailImages extends Context.Service<ThumbnailImages, {
  // whether an image key is set (else the stage draws its basic thumbnail)
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

      const option = Effect.fn("ThumbnailImages.option")(function*(n: number, prompt: string, images: ReadonlyArray<Uint8Array>, dir: string) {
        const made = yield* eleven.image({
          model: THUMBNAIL_IMAGE_MODEL,
          prompt,
          images: images.map((data) => ({ data, mimeType: "image/jpeg" })),
          aspectRatio: "9:16",
          resolution: "2K",
          quality: "high"
        })
        const raw = path.join(dir, `option-${n}-original.${made.mimeType === "image/jpeg" ? "jpg" : made.mimeType === "image/webp" ? "webp" : "png"}`)
        yield* fs.writeFile(raw, made.data).pipe(Effect.mapError(fail("write")))
        const name = `option-${n}.jpg`
        yield* ffmpeg(["-i", raw, "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`, "-q:v", "2"], path.join(dir, name))
        return { image: name, credits: made.credits ?? THUMBNAIL_IMAGE_CREDITS }
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
        const images = yield* Effect.forEach(inputs, (i) => fs.readFile(path.join(input.dir, i.file)).pipe(Effect.mapError(fail("read"))))
        yield* input.progress(null, `asking ${THUMBNAIL_IMAGE_MODEL} for ${THUMBNAIL_OPTIONS} thumbnails from ${inputs.length} real frames`)
        const results = yield* Effect.forEach(
          Array.from({ length: THUMBNAIL_OPTIONS }, (_, i) => i + 1),
          (n) =>
            option(n, prompt, images, input.dir).pipe(
              Effect.map((made) => ({ ...made, failure: null as string | null })),
              Effect.catchTag("VoiceError", (error) => Effect.succeed({ image: null as string | null, credits: 0, failure: optionFailure(error) }))
            ),
          { concurrency: THUMBNAIL_OPTIONS }
        )
        const credits = results.reduce((n, r) => n + r.credits, 0)
        if (credits > 0) {
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
        }
        const failures = results.flatMap((r) => r.failure === null ? [] : [r.failure])
        const hint = celebrityHint(failures)
        const options = results.map((r): ThumbnailOption => ({
          image: r.image,
          failure: r.failure === null ? null : `${r.failure}${results.every((x) => x.image === null) ? hint : ""}`,
          faces: null,
          note: null
        }))
        return { ...base, options, credits } satisfies Round
      })

      return ThumbnailImages.of({ ready: eleven.imagesReady, frames, make })
    })
  ).pipe(Layer.provide([UsageRecords.layer, SourcePieces.layer, NodeServices.layer]))
}
