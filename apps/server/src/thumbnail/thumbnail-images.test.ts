import { NodeServices } from "@effect/platform-node"
import type { ThumbnailDesign } from "@viral/contracts"
import { Effect, Layer } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { ViralHome } from "../home/viral-home.ts"
import { UsageReport } from "../usage/usage.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { GatewayImages, ThumbnailImages } from "./thumbnail-images.ts"

// A key whose ElevenLabs plan can't make images (402) falls back to the AI Gateway, which serves the same model. Both
// are fakes on one local server (never a real account); the Gateway reports what each image cost.
let server: Server
let home: string
let video: string
let picture: Buffer
const gatewayCalls: Array<{ readonly auth: string | undefined; readonly model: string | undefined; readonly body: Record<string, unknown> }> = []
let elevenCalls = 0
const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = ""
    req.on("data", (chunk) => void (data += chunk))
    req.on("end", () => resolve(data))
  })

before(async () => {
  home = mkdtempSync(join(tmpdir(), "viral-thumbnail-gateway-"))
  process.env.VIRAL_HOME = home
  process.env.ELEVENLABS_API_KEY = "test-key"
  process.env.AI_GATEWAY_API_KEY = "gateway-test-key"
  video = join(home, "clip.mp4")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=30:s=320x180:r=10", video])
  const png = join(home, "generated.png")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=1024x1536", "-frames:v", "1", png])
  picture = readFileSync(png)
  server = createServer(async (req, res) => {
    const text = await body(req)
    const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value))
    if (req.method === "POST" && req.url === "/v1/flows/image") {
      elevenCalls++
      return json(402, { detail: { status: "payment_required", message: "This endpoint requires a Pro plan or above." } })
    }
    if (req.method === "POST" && req.url === "/v3/ai/image-model") {
      gatewayCalls.push({ auth: req.headers.authorization, model: req.headers["ai-model-id"] as string | undefined, body: JSON.parse(text) as Record<string, unknown> })
      return json(200, {
        images: [picture.toString("base64")],
        providerMetadata: { gateway: { cost: "0.2125" } },
        usage: { inputTokens: 3000, outputTokens: 6600 }
      })
    }
    json(404, { error: { message: "not found" } })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.ELEVENLABS_API_URL = base
  process.env.AI_GATEWAY_API_URL = base
})
after(() => {
  server.close()
  rmSync(home, { recursive: true, force: true })
})

const design: ThumbnailDesign = {
  graphic: null,
  words: "7 TASTES",
  hero: { src: 12, what: "red skull-shaped candy", dramatise: "glowing" },
  escalation: null,
  reactions: [{ src: 10, look: "calm" }, { src: 20, look: "pain" }],
  person: "a bearded man in a cap",
  prop: null,
  background: "rainbow explosion",
  celebrity: null
}

const make = (gateway: boolean) =>
  Effect.runPromise(ThumbnailImages.use((images) =>
    images.make({
      design,
      videos: [{ index: 0, path: video, source: { id: "src-gateway", origin: { _tag: "File", path: video } } as never }],
      dir: join(home, `round-${gateway}`),
      projectId: null,
      progress: () => Effect.void
    })
  ).pipe(
    Effect.provide(ThumbnailImages.layer.pipe(Layer.provideMerge(ElevenLabs.layer))),
    Effect.provideService(GatewayImages, { enabled: gateway })
  ))

test("off by default (tests, without main.ts), the Gateway isn't used: the plan's refusal is what the gate shows", async () => {
  const round = await make(false)
  assert.equal(gatewayCalls.length, 0)
  assert.equal(round.service, "elevenlabs")
  assert.deepEqual(round.options.map((o) => o.image), [null, null, null])
  assert.match(round.options[0]!.failure ?? "", /Your ElevenLabs plan can't make images/)
  assert.doesNotMatch(round.options[0]!.failure ?? "", /public figures/, "a plan refusal isn't a celebrity block")
})

test("an ElevenLabs plan without images falls back to the AI Gateway, whose reported cost goes to Settings › Usage", async () => {
  elevenCalls = 0
  const round = await make(true)
  assert.equal(elevenCalls, 3, "ElevenLabs first (Decision 7), then the Gateway")
  assert.equal(round.service, "ai-gateway")
  assert.deepEqual(round.options.map((o) => o.image), ["option-1.jpg", "option-2.jpg", "option-3.jpg"])
  assert.ok(existsSync(join(home, "round-true", "option-1.jpg")))
  assert.equal(gatewayCalls.length, 3)
  const call = gatewayCalls[0]!
  assert.equal(call.auth, "Bearer gateway-test-key")
  assert.equal(call.model, "openai/gpt-image-2.5-sunburst")
  assert.equal(call.body.aspectRatio, "9:16")
  assert.equal((call.body.files as ReadonlyArray<unknown>).length, 3, "the real frames go as reference images")
  assert.match(String(call.body.prompt), /Copy both faces photographically from images 1 and 2/)
  assert.ok(Math.abs((round.costUsd ?? 0) - 0.6375) < 1e-6)
  assert.equal(round.credits, 0)
  const usage = await Effect.runPromise(UsageReport.use((r) => r.get(1)).pipe(Effect.provide(Layer.mergeAll(UsageReport.layer, ViralHome.layer, NodeServices.layer))))
  const step = usage.byStage.find((s) => s.stage === "thumbnail")
  assert.ok(Math.abs((step?.costUsd ?? 0) - 0.6375) < 1e-6, `${step?.costUsd}`)
})
