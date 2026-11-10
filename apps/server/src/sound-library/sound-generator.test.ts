import { NodeServices } from "@effect/platform-node"
import { ConfigProvider, Effect, Layer } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { UsageReport } from "../usage/usage.ts"
import { UsageRecords } from "../usage/usage-records.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { generateSoundEffects, mp3Seconds } from "./sound-generator.ts"
import { nextVariant, SoundLibrary, soundStem } from "./sound-library.ts"

// A fake ElevenLabs Sound Effects (never the real account): an mp3 of 16 000 bytes (1 s at 128 kb/s) per call, billed
// 40 credits a second when a length is asked for (not the estimate, so the test sees the reported bill is what counts).
let server: Server
let base: string
let home: string
const requests: Array<{ url: string; body: string }> = []
const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = ""
    req.on("data", (chunk) => void (data += chunk))
    req.on("end", () => resolve(data))
  })

before(async () => {
  home = mkdtempSync(join(tmpdir(), "viral-sfx-"))
  process.env.VIRAL_HOME = home
  server = createServer(async (req, res) => {
    const text = await body(req)
    requests.push({ url: req.url ?? "", body: text })
    if (req.headers["xi-api-key"] !== "test-key") return res.writeHead(401).end()
    if (req.method === "POST" && req.url?.startsWith("/v1/sound-generation")) {
      const asked = JSON.parse(text) as { readonly duration_seconds: number | null }
      const cost = asked.duration_seconds === null ? {} : { "character-cost": String(Math.ceil(asked.duration_seconds * 40)) }
      return res.writeHead(200, { "content-type": "audio/mpeg", ...cost }).end(Buffer.alloc(16_000, requests.length))
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => {
  server.close()
  rmSync(home, { recursive: true, force: true })
})

const run = <A, E>(effect: Effect.Effect<A, E, ElevenLabs | UsageRecords | UsageReport | SoundLibrary>) =>
  Effect.runPromise(effect.pipe(
    Effect.provide(Layer.mergeAll(ElevenLabs.layer, UsageRecords.layer, UsageReport.layer, SoundLibrary.layer, NodeServices.layer).pipe(
      Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown({ ELEVENLABS_API_KEY: "test-key", ELEVENLABS_API_URL: base, VIRAL_HOME: home })))
    ))
  ))

const request = {
  prompt: "A short whoosh that swells into a deep bass hit.",
  category: "whoosh" as const,
  durationS: 1.5,
  loop: false,
  promptInfluence: 0.4,
  takes: 2,
  projectId: null
}

test("names come from the prompt, with the next free variant", () => {
  assert.equal(soundStem(request.prompt), "short-whoosh-swells-deep")
  assert.equal(soundStem("!!!"), "sound")
  assert.equal(nextVariant("pop", ["pop-01", "pop-03"]), "pop-02")
  assert.equal(mp3Seconds(16_000), 1)
})

test("each take is made, billed to Usage and kept in the sound library with its prompt", async () => {
  requests.length = 0
  const made = await run(generateSoundEffects(request))
  assert.equal(requests.length, 2)
  assert.deepEqual(JSON.parse(requests[0]!.body), {
    text: request.prompt,
    model_id: "eleven_text_to_sound_v3",
    duration_seconds: 1.5,
    prompt_influence: 0.4,
    loop: false
  })
  assert.deepEqual(made.map((s) => [s.category, s.name, s.path, s.durationS]), [
    ["whoosh", "short-whoosh-swells-deep-01", "whoosh/short-whoosh-swells-deep-01.mp3", 1.5],
    ["whoosh", "short-whoosh-swells-deep-02", "whoosh/short-whoosh-swells-deep-02.mp3", 1.5]
  ])
  assert.equal(readFileSync(join(home, "sounds", made[0]!.path)).byteLength, 16_000)
  assert.equal(made[0]!.origin._tag === "Generated" && made[0]!.origin.prompt, request.prompt)
  const usage = await run(UsageReport.use((r) => r.get(1)))
  assert.deepEqual(usage.byStage.find((s) => s.stage === "sound-effect"), { stage: "sound-effect", model: "eleven_text_to_sound_v3", runs: 2, costUsd: 0, ttsCharacters: 120 })
})

test("a length left to ElevenLabs is measured from the file; deleting removes the sound and its file", async () => {
  const [auto] = await run(generateSoundEffects({ ...request, durationS: null, takes: 1, category: "pop", prompt: "Bubble pop" }))
  assert.deepEqual([auto!.name, auto!.durationS], ["bubble-pop-01", 1])
  assert.equal(await run(SoundLibrary.use((s) => s.remove(auto!.id))), true)
  assert.equal(existsSync(join(home, "sounds", auto!.path)), false)
  assert.equal(await run(SoundLibrary.use((s) => s.remove(auto!.id))), false)
  const empty = await run(Effect.flip(generateSoundEffects({ ...request, prompt: "  " })))
  assert.equal(empty.code, "prompt")
})
