import type { ModelMessage } from "ai"

// An AI SDK run's conversation, kept between attempts so a rejected or fixed result continues the same
// conversation (the CLI keeps its own sessions; the model APIs keep none). Image bytes aren't written into it:
// each image keeps the file it came from, and is read again on resume. That covers the brief's images (image
// parts) and the images a helper tool returned (file parts inside a tool result, named by their file).

type Part = { readonly type: string } & Record<string, unknown>
const isPart = (value: unknown): value is Part => typeof value === "object" && value !== null && "type" in value

// Applies `f` to every part of every message, including the parts inside a tool result's content.
const mapParts = (messages: ReadonlyArray<unknown>, f: (part: Part) => unknown): Array<unknown> =>
  messages.map((message) => {
    if (typeof message !== "object" || message === null || !("content" in message) || !Array.isArray(message.content)) return message
    return {
      ...message,
      content: message.content.map((part: unknown) => {
        if (!isPart(part)) return part
        const output = part["output"]
        if (part.type === "tool-result" && isPart(output) && output.type === "content" && Array.isArray(output["value"])) {
          return { ...part, output: { ...output, value: output["value"].map((inner: unknown) => isPart(inner) ? f(inner) : inner) } }
        }
        return f(part)
      })
    }
  })

const fileData = (part: Part): unknown => {
  const data = part["data"]
  return isPart(data) && data.type === "data" ? data["data"] : undefined
}

// For storing: image parts and tool-result images point at their file; one with no known file becomes a short note.
export const encodeHistory = (messages: ReadonlyArray<ModelMessage>, fileOf: (image: unknown) => string | undefined) =>
  mapParts(messages, (part) => {
    if (part.type === "image") {
      const file = fileOf(part["image"])
      return file === undefined
        ? { type: "text", text: "[an image that wasn't kept]" }
        : { type: "image", file, mediaType: part["mediaType"] }
    }
    if (part.type === "file") {
      const bytes = fileData(part)
      if (bytes === undefined) return part
      const file = typeof part["filename"] === "string" ? part["filename"] : fileOf(bytes)
      return file === undefined
        ? { type: "text", text: "[an image that wasn't kept]" }
        : { type: "file", file, mediaType: part["mediaType"] }
    }
    return part
  })

// Every image file a stored conversation refers to, so they can be read before decoding it.
export const historyFiles = (stored: ReadonlyArray<unknown>): ReadonlyArray<string> => {
  const files = new Set<string>()
  mapParts(stored, (part) => {
    if ((part.type === "image" || part.type === "file") && typeof part["file"] === "string") files.add(part["file"])
    return part
  })
  return [...files]
}

// For resuming: each image is read back from its file; one that's gone becomes a note.
export const decodeHistory = (stored: ReadonlyArray<unknown>, read: (file: string) => Uint8Array | undefined): Array<ModelMessage> =>
  mapParts(stored, (part) => {
    if ((part.type !== "image" && part.type !== "file") || typeof part["file"] !== "string") return part
    const file = part["file"]
    const bytes = read(file)
    if (bytes === undefined) return { type: "text", text: `[an image that's no longer there: ${file}]` }
    return part.type === "image"
      ? { type: "image", image: bytes, mediaType: part["mediaType"] }
      : { type: "file", mediaType: part["mediaType"], filename: file, data: { type: "data", data: bytes } }
  }) as Array<ModelMessage>
