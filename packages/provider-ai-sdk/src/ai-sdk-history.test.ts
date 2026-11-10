import type { ModelMessage } from "ai"
import assert from "node:assert/strict"
import { test } from "node:test"
import { decodeHistory, encodeHistory } from "./ai-sdk-history.ts"

const sheet = new Uint8Array([1, 2, 3])
const messages: Array<ModelMessage> = [
  {
    role: "user",
    content: [
      { type: "text", text: "Map the story." },
      { type: "image", image: sheet, mediaType: "image/png" },
      { type: "image", image: new Uint8Array([9]), mediaType: "image/png" }
    ]
  },
  { role: "assistant", content: [{ type: "text", text: "Looking." }] }
]

test("stored histories keep image files, not bytes, and read them back on resume", () => {
  const stored = encodeHistory(messages, (image) => image === sheet ? "/sheets/sheet_000.png" : undefined)
  assert.deepEqual((stored[0] as { content: Array<unknown> }).content.slice(1), [
    { type: "image", file: "/sheets/sheet_000.png", mediaType: "image/png" },
    { type: "text", text: "[an image that wasn't kept]" }
  ])
  assert.deepEqual(stored[1], messages[1], "text messages are stored as they are")

  const restored = decodeHistory(stored, (file) => file === "/sheets/sheet_000.png" ? sheet : undefined)
  assert.deepEqual(restored[0], { ...messages[0], content: [messages[0]!.content[0], { type: "image", image: sheet, mediaType: "image/png" }, { type: "text", text: "[an image that wasn't kept]" }] })

  const gone = decodeHistory(stored, () => undefined)
  assert.deepEqual((gone[0] as { content: Array<unknown> }).content[1], { type: "text", text: "[an image that's no longer there: /sheets/sheet_000.png]" })
})
