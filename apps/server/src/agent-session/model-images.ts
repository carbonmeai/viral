import { type ImageReader, MAX_IMAGE_BYTES, type ModelImage } from "@viral/provider-ai-sdk"
import { Effect, FileSystem, Option, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

// The longest side an image keeps when it's sent to a model API. Anthropic scales anything bigger down to this
// anyway (and bills by pixels), OpenAI and Gemini tile it; a 1920px contact sheet PNG of 2.4 MB becomes a JPEG of a
// few hundred KB that reads the same.
export const MAX_EDGE = 1568
// images at most this big are sent as they are (frames, thumbnails); bigger ones are scaled and re-encoded
export const SEND_AS_IS_BYTES = 500_000

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")

// Reads images for the AI SDK providers: small ones as they are, big ones scaled to MAX_EDGE as a JPEG by ffmpeg
// (Viral's own tool). Each scaled copy is kept in `cacheDir` under a hash of the file's path, size and time, so a
// fix round or a resume sends the same bytes without scaling again. The model is still told the original file.
export const modelImageReader = Effect.fn("modelImageReader")(function*(cacheDir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  const raw = (file: string, mediaType: string) =>
    fs.readFile(file).pipe(
      Effect.map((bytes) => bytes.byteLength > MAX_IMAGE_BYTES ? Option.none<ModelImage>() : Option.some<ModelImage>({ file, bytes, mediaType })),
      Effect.orElseSucceed(() => Option.none<ModelImage>())
    )

  const read: ImageReader = Effect.fn("ModelImages.read")(function*(file: string) {
    const mediaType = TYPES[path.extname(file).toLowerCase()]
    if (mediaType === undefined) return Option.none<ModelImage>()
    const info = yield* fs.stat(file).pipe(Effect.option)
    if (Option.isNone(info)) return Option.none<ModelImage>()
    if (Number(info.value.size) <= SEND_AS_IS_BYTES) return yield* raw(file, mediaType)

    const stamp = `${file}:${Number(info.value.size)}:${Option.match(info.value.mtime, { onNone: () => 0, onSome: (d) => d.getTime() })}`
    const name = hex(yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(stamp)))).slice(0, 32)
    const scaled = path.join(cacheDir, `${name}.jpg`)
    if (!(yield* fs.exists(scaled).pipe(Effect.orElseSucceed(() => false)))) {
      yield* fs.makeDirectory(cacheDir, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))
      const temp = path.join(cacheDir, `.${name}.jpg`)
      const exit = yield* spawner.exitCode(ChildProcess.make("ffmpeg", [
        "-y", "-loglevel", "error", "-i", file, "-frames:v", "1",
        "-vf", `scale='min(${MAX_EDGE},iw)':'min(${MAX_EDGE},ih)':force_original_aspect_ratio=decrease`,
        "-q:v", "3", "-f", "image2", temp
      ])).pipe(Effect.orElseSucceed(() => ChildProcessSpawner.ExitCode(1)))
      // no ffmpeg, or a file it can't read: send the original if it fits
      if (exit !== ChildProcessSpawner.ExitCode(0)) return yield* raw(file, mediaType)
      yield* fs.rename(temp, scaled).pipe(Effect.orElseSucceed(() => undefined))
    }
    const bytes = yield* fs.readFile(scaled).pipe(Effect.option)
    return Option.isNone(bytes) ? yield* raw(file, mediaType) : Option.some<ModelImage>({ file, bytes: bytes.value, mediaType: "image/jpeg" })
  })

  return read
})
