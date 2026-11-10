import type { ModelMessage } from "ai"

// An AI SDK run's conversation, kept between attempts so a rejected or fixed result continues the same
// conversation (the CLI keeps its own sessions; the model APIs keep none). Image bytes aren't written into it:
// each image part keeps the file it came from, and is read again on resume.

type Part = { readonly type: string } & Record<string, unknown>
const isPart = (value: unknown): value is Part => typeof value === "object" && value !== null && "type" in value

const mapParts = (messages: ReadonlyArray<unknown>, f: (part: Part) => unknown): Array<unknown> =>
  messages.map((message) => {
    if (typeof message !== "object" || message === null || !("content" in message) || !Array.isArray(message.content)) return message
    return { ...message, content: message.content.map((part: unknown) => isPart(part) ? f(part) : part) }
  })

// For storing: image parts point at their file; one with no known file becomes a short note.
export const encodeHistory = (messages: ReadonlyArray<ModelMessage>, fileOf: (image: unknown) => string | undefined) =>
  mapParts(messages, (part) => {
    if (part.type !== "image") return part
    const file = fileOf(part["image"])
    return file === undefined
      ? { type: "text", text: "[an image that wasn't kept]" }
      : { type: "image", file, mediaType: part["mediaType"] }
  })

// For resuming: each image is read back from its file; one that's gone becomes a note.
export const decodeHistory = (stored: ReadonlyArray<unknown>, read: (file: string) => Uint8Array | undefined): Array<ModelMessage> =>
  mapParts(stored, (part) => {
    if (part.type !== "image" || typeof part["file"] !== "string") return part
    const bytes = read(part["file"])
    return bytes === undefined
      ? { type: "text", text: `[an image that's no longer there: ${part["file"]}]` }
      : { type: "image", image: bytes, mediaType: part["mediaType"] }
  }) as Array<ModelMessage>
