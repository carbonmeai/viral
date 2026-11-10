import { ConfigProvider, Effect, Layer } from "effect"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, test } from "node:test"
import { ElevenLabs } from "./eleven-labs.ts"

// A fake ElevenLabs text to speech. Like the real one (checked 10 Nov: 133 characters of text billed 53, 242 billed 97),
// it bills 0.4 a character in its `character-cost` header; voice "no-header" answers without the header.
let server: Server
let base: string
const bodies: Array<{ text: string; model_id: string }> = []

before(async () => {
  server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => raw += chunk)
    req.on("end", () => {
      const body = JSON.parse(raw) as { text: string; model_id: string }
      bodies.push(body)
      const headers: Record<string, string> = { "content-type": "audio/mpeg" }
      if (!req.url?.startsWith("/v1/text-to-speech/no-header")) headers["character-cost"] = String(Math.round(body.text.length * 0.4))
      res.writeHead(200, headers).end(Buffer.from([0xff, 0xf3, 0x00, 0x00]))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => void server.close())

const speak = (voiceId: string, text: string) =>
  Effect.runPromise(Effect.gen(function*() {
    return yield* (yield* ElevenLabs).speak({ voiceId, model: "eleven_v4", text })
  }).pipe(Effect.provide(ElevenLabs.layer.pipe(
    Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown({ ELEVENLABS_API_URL: base, ELEVENLABS_API_KEY: "test-key" })))
  ))))

const LINE = "He ate the hottest candy in the world. Then he tried to make it even hotter, and that was a terrible idea. Nobody saw what came next."

test("a take's characters are what ElevenLabs billed (its character-cost header), not the text's length", async () => {
  const speech = await speak("marcus", LINE)
  assert.equal(LINE.length, 133)
  assert.equal(speech.characters, 53)
  assert.deepEqual(bodies.at(-1), { text: LINE, model_id: "eleven_v4" })
  assert.ok(speech.audio.length > 0)
})

test("without the header, the text's length stands in for the bill", async () => {
  const speech = await speak("no-header", LINE)
  assert.equal(speech.characters, 133)
})
