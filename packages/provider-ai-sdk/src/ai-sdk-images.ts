import type { FilePart, ModelMessage, TextPart, ToolResultPart } from "ai"
import { Effect, FileSystem, Option, Path } from "effect"

// Images on the AI SDK providers. A model API can't open a file, so the images a stage's helper tools draw (detail
// contact sheets, previews) go back to the model as image content in the tool's result, and `view_image` shows any
// other image the brief or a tool named. Sizes and counts are kept sane: images are downscaled before they're sent
// (the app's `readImage`), a result carries a few at most, a run a few dozen, and only the latest ones stay in the
// conversation the model is sent (older ones become a line saying how to see them again).

export const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }

// An image ready for a model: the file it shows (what the model is told), and the bytes sent (maybe a smaller copy).
export interface ModelImage {
  readonly file: string
  readonly bytes: Uint8Array
  readonly mediaType: string
}

// Reads an image for a model; none when it isn't an image, can't be read, or is too big to send.
export type ImageReader = (file: string) => Effect.Effect<Option.Option<ModelImage>>

// Every vendor takes an image up to 5 MB once base64-encoded (Anthropic's limit is the tightest): 3.75 MB of bytes.
export const MAX_IMAGE_BYTES = 3_750_000
// the images one tool result carries (a detail sheet is two, a preview one)
export const MAX_IMAGES_PER_RESULT = 4
// the tool images one run may attach in all; past it, tools answer with text only
export const MAX_RUN_IMAGES = 24
// the tool images kept in what the model is sent each step, newest first; older ones are replaced by a line
export const KEEP_IMAGES = 6

export const isImageFile = (file: string) => IMAGE_TYPES[file.slice(file.lastIndexOf(".")).toLowerCase()] !== undefined

// The reader used when the app gives none: the file's own bytes, if it's an image under the size limit.
export const rawImageReader = Effect.fn("AiSdk.rawImageReader")(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  return Effect.fn("AiSdk.readImage")(function*(file: string) {
    const mediaType = IMAGE_TYPES[path.extname(file).toLowerCase()]
    if (mediaType === undefined) return Option.none<ModelImage>()
    const bytes = yield* fs.readFile(file).pipe(Effect.option)
    if (Option.isNone(bytes) || bytes.value.byteLength > MAX_IMAGE_BYTES) return Option.none<ModelImage>()
    return Option.some<ModelImage>({ file, bytes: bytes.value, mediaType })
  })
})

// What a helper tool's result is on an AI SDK provider: its text and the images it drew, read and ready.
export interface ToolImages {
  readonly text: string
  readonly images: ReadonlyArray<ModelImage>
}

// The model's view of a tool result: text alone, or the text then each image, labelled with its file. The file is
// also the image part's `filename`, so a stored conversation can point at it instead of keeping the bytes.
export const toolOutput = (result: ToolImages): ToolResultPart["output"] =>
  result.images.length === 0
    ? { type: "text", value: result.text }
    : {
      type: "content",
      value: [
        { type: "text", text: result.text },
        ...result.images.flatMap((image) => [
          { type: "text" as const, text: `Image: ${image.file}` },
          { type: "file" as const, mediaType: image.mediaType, filename: image.file, data: { type: "data" as const, data: image.bytes } }
        ])
      ]
    }

// Where a vendor takes a tool's images: inside the tool result (Anthropic, OpenAI Responses, Gemini, the AI
// Gateway), or as a user message right after it (OpenRouter's chat completions, whose upstream models don't all
// take images in a tool message).
export type ToolImagePlacement = "in-result" | "user-message"

type Part = { readonly type: string } & Record<string, unknown>
const isPart = (value: unknown): value is Part => typeof value === "object" && value !== null && "type" in value
const isImageFilePart = (part: unknown): part is Part => {
  if (!isPart(part) || part.type !== "file") return false
  const data = part["data"]
  return isPart(data) && data.type === "data" && typeof part["mediaType"] === "string" && String(part["mediaType"]).startsWith("image/")
}

const contentOf = (part: Part): ReadonlyArray<unknown> | undefined => {
  const output = part["output"]
  return part.type === "tool-result" && isPart(output) && output.type === "content" && Array.isArray(output["value"]) ? output["value"] : undefined
}

const withContent = (part: Part, value: ReadonlyArray<unknown>) => ({ ...part, output: { ...(part["output"] as object), value } })

const nameOf = (part: Part) => typeof part["filename"] === "string" ? part["filename"] : "an image"

// What the model is sent for a step, from the whole conversation so far: tool images past the newest `keep` become a
// line saying how to see them again, and on a "user-message" vendor the remaining ones move out of their tool result
// into a user message right after it. Brief images (the first user message's) are left alone. Pure: it's applied
// to the full conversation every step, so it never compounds.
export const stepMessages = (
  messages: ReadonlyArray<ModelMessage>,
  placement: ToolImagePlacement,
  keep: number = KEEP_IMAGES
): Array<ModelMessage> => {
  // newest first: which tool images stay
  let kept = 0
  const pruned = [...messages].reverse().map((message): ModelMessage => {
    if (message.role !== "tool") return message
    const content = [...message.content].reverse().map((part) => {
      const value = isPart(part) ? contentOf(part) : undefined
      if (value === undefined) return part
      const next = [...value].reverse().map((inner) => {
        if (!isImageFilePart(inner)) return inner
        if (kept < keep) {
          kept++
          return inner
        }
        return { type: "text", text: `[${nameOf(inner)} is no longer attached; call view_image to see it again]` }
      }).reverse()
      return withContent(part as Part, next)
    }).reverse()
    return { ...message, content } as ModelMessage
  }).reverse()
  if (placement === "in-result") return pruned

  return pruned.flatMap((message): Array<ModelMessage> => {
    if (message.role !== "tool") return [message]
    const moved: Array<TextPart | FilePart> = []
    const content = message.content.map((part) => {
      const value = isPart(part) ? contentOf(part) : undefined
      if (value === undefined) return part
      return withContent(
        part as Part,
        value.map((inner) => {
          if (!isImageFilePart(inner)) return inner
          moved.push({ type: "text", text: `Image: ${nameOf(inner)}` }, inner as unknown as FilePart)
          return { type: "text", text: `(${nameOf(inner)} is attached in the next message)` }
        })
      )
    })
    const tool = { ...message, content } as ModelMessage
    return moved.length === 0 ? [tool] : [tool, { role: "user", content: [{ type: "text", text: "The images from the tool results above:" }, ...moved] }]
  })
}
