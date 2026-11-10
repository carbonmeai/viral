import { NodeServices } from "@effect/platform-node"
import { ConfigProvider, Effect, Layer } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { ViralHome } from "../home/viral-home.ts"
import { UsageReport } from "../usage/usage.ts"
import { UsageRecords } from "../usage/usage-records.ts"
import { ElevenLabs } from "./eleven-labs.ts"
import { designVoices } from "./voice-design.ts"

// A fake ElevenLabs Voice Design: three previews per description, a character bill, and saving one as your voice. Never
// the real account.
let server: Server
let base: string
let home: string
const requests: Array<{ method: string; url: string; body: string }> = []
const saved: Array<{ voice_id: string; name: string; category: string }> = []
const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = ""
    req.on("data", (chunk) => void (data += chunk))
    req.on("end", () => resolve(data))
  })

before(async () => {
  home = mkdtempSync(join(tmpdir(), "viral-voice-design-"))
  process.env.VIRAL_HOME = home
  server = createServer(async (req, res) => {
    const text = await body(req)
    requests.push({ method: req.method ?? "", url: req.url ?? "", body: text })
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
      res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(value))
    if (req.headers["xi-api-key"] !== "test-key") return json(401, { detail: { status: "invalid_api_key", message: "bad key" } })
    const url = new URL(req.url ?? "", "http://x")
    if (req.method === "POST" && url.pathname === "/v1/text-to-voice/design") {
      const asked = JSON.parse(text) as { readonly text: string }
      return json(200, {
        previews: ["a", "b", "c"].map((id, i) => ({
          audio_base_64: Buffer.from(`mp3-${id}`).toString("base64"),
          generated_voice_id: `gen-${id}`,
          media_type: "audio/mpeg",
          duration_secs: 6 + i,
          language: "en"
        })),
        text: asked.text
      }, { "character-cost": "312" })
    }
    if (req.method === "POST" && url.pathname === "/v1/text-to-voice") {
      const asked = JSON.parse(text) as { readonly voice_name: string; readonly generated_voice_id: string }
      saved.push({ voice_id: `voice-${asked.generated_voice_id}`, name: asked.voice_name, category: "generated" })
      return json(200, { voice_id: `voice-${asked.generated_voice_id}` })
    }
    if (req.method === "GET" && url.pathname === "/v1/voices") return json(200, { voices: saved.map((v) => ({ ...v, labels: {}, preview_url: null })) })
    json(404, { detail: "not found" })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => {
  server.close()
  rmSync(home, { recursive: true, force: true })
})

const run = <A, E>(effect: Effect.Effect<A, E, ElevenLabs | UsageRecords | UsageReport | ViralHome | NodeServices.NodeServices>) =>
  Effect.runPromise(effect.pipe(
    Effect.provide(Layer.mergeAll(ElevenLabs.layer, UsageRecords.layer, UsageReport.layer, ViralHome.layer, NodeServices.layer).pipe(
      Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown({ ELEVENLABS_API_KEY: "test-key", ELEVENLABS_API_URL: base, VIRAL_HOME: home })))
    ))
  ))

const LINE = "This guy made a candy that hits every single taste at the exact same time, and it took him three whole years to get it right."
const WORDS = "A warm, fast American narrator in his thirties. Curious, a little amazed, never shouting."

test("designing a voice gives three previews in the Viral home, bills their characters, and adds nothing to your voices", async () => {
  requests.length = 0
  const made = await run(designVoices(WORDS, LINE, null))
  const sent = JSON.parse(requests.find((r) => r.url.startsWith("/v1/text-to-voice/design"))!.body)
  assert.deepEqual(sent, { voice_description: WORDS, model_id: "eleven_ttv_v3", text: LINE })
  assert.equal(made.characters, 312)
  assert.deepEqual(made.previews.map((p) => [p.previewId, p.durationS]), [["gen-a", 6], ["gen-b", 7], ["gen-c", 8]])
  for (const p of made.previews) {
    assert.ok(p.path.startsWith(join(home, "voice-previews")))
    assert.equal(readFileSync(p.path, "utf8"), `mp3-${p.previewId.slice(4)}`)
  }
  assert.equal(requests.some((r) => r.url === "/v1/text-to-voice"), false, "nothing saved to the account")
  const usage = await run(UsageReport.use((r) => r.get(1)))
  assert.deepEqual(usage.byStage.find((s) => s.stage === "voice-design"), { stage: "voice-design", model: "eleven_ttv_v3", runs: 1, costUsd: 0, ttsCharacters: 312 })
})

test("a description or line ElevenLabs would refuse is caught before anything is spent", async () => {
  requests.length = 0
  const short = await run(Effect.flip(designVoices("deep", LINE, null)))
  assert.equal(short.code, "prompt")
  const line = await run(Effect.flip(designVoices(WORDS, "Too short.", null)))
  assert.match(line.message, /100–1000 characters \(it has 10\)/)
  assert.equal(requests.length, 0)
  assert.equal(existsSync(join(home, "voice-previews", "designed-x.mp3")), false)
})

test("saving a designed voice keeps it as yours under the name you gave", async () => {
  const voice = await run(ElevenLabs.use((e) => e.saveDesigned("gen-b", "Warm narrator", WORDS)))
  const sent = JSON.parse(requests.find((r) => r.url === "/v1/text-to-voice")!.body)
  assert.deepEqual(sent, { voice_name: "Warm narrator", voice_description: WORDS, generated_voice_id: "gen-b" })
  assert.deepEqual([voice.voiceId, voice.name, voice.category], ["voice-gen-b", "Warm narrator", "generated"])
})
