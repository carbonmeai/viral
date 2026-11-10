import { type RunUpdate, Thumbnail, THUMBNAIL_IMAGE_MODEL } from "@viral/contracts"
import { replayAnswer } from "@viral/provider-testing"
import { Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession, type AgentTask } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Projects } from "../projects/projects.ts"
import { PipelineStagesLive } from "../runs/pipeline-stages.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { Sources } from "../sources/sources.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { UsageReport } from "../usage/usage.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { ThumbnailImages } from "./thumbnail-images.ts"

// AI thumbnails against a fake ElevenLabs Image & Video API (never the real account): three options per round, the
// second refused by moderation in the first round; downloads come from a signed address that must not see the key.
let server: Server
let base: string
let home: string
let picture: Buffer
const created: Array<{ readonly body: Record<string, unknown> }> = []
const downloads: Array<{ readonly key: string | undefined }> = []
const polled = new Map<string, number>()
const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = ""
    req.on("data", (chunk) => void (data += chunk))
    req.on("end", () => resolve(data))
  })

before(async () => {
  home = mkdtempSync(join(tmpdir(), "viral-thumbnail-images-"))
  process.env.VIRAL_HOME = home
  process.env.VIRAL_CUTOUT = "off"
  // the fake's key and address win over a real key in .env
  process.env.ELEVENLABS_API_KEY = "test-key"
  const png = join(home, "generated.png")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=orange:s=576x1024", "-frames:v", "1", png])
  picture = readFileSync(png)
  server = createServer(async (req, res) => {
    const text = await body(req)
    const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value))
    const url = new URL(req.url ?? "", "http://x")
    if (req.method === "GET" && url.pathname.startsWith("/content/")) {
      downloads.push({ key: req.headers["xi-api-key"] as string | undefined })
      return res.writeHead(200, { "content-type": "image/png" }).end(picture)
    }
    if (req.headers["xi-api-key"] !== "test-key") return json(401, { detail: { status: "invalid_api_key", message: "bad key" } })
    if (req.method === "POST" && url.pathname === "/v1/flows/image") {
      created.push({ body: JSON.parse(text) as Record<string, unknown> })
      return json(200, { id: `gen-${created.length}`, status: "pending" })
    }
    const asked = /^\/v1\/flows\/image\/(.+)$/.exec(url.pathname)?.[1]
    if (req.method === "GET" && asked !== undefined) {
      const n = (polled.get(asked) ?? 0) + 1
      polled.set(asked, n)
      if (n === 1) return json(200, { id: asked, status: "generating" })
      if (asked === "gen-2") {
        return json(200, { id: asked, status: "failed", failure_reason: "moderated", error_message: "The prompt was rejected by content moderation. You were not charged for this generation." })
      }
      return json(200, { id: asked, status: "completed", content_url: `${base}/content/${asked}`, content_mime_type: "image/png" })
    }
    json(404, { detail: "not found" })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.ELEVENLABS_API_URL = base
})
after(() => {
  server.close()
  rmSync(home, { recursive: true, force: true })
})

const design = {
  graphic: { src: 25, what: "\"TASTE METER\" bar graphic" },
  words: "7 tastes",
  hero: { src: 12, what: "red skull-shaped candy", dramatise: "glowing, cracked open with colour bursting out" },
  escalation: "7 candies from sweet to fiery",
  reactions: [{ src: 10, look: "calm, tasting" }, { src: 20, look: "eyes squeezed shut, hand on forehead" }],
  person: "a bearded man in a beige cap and black t-shirt",
  prop: null,
  background: "hyper-saturated rainbow explosion with splashes",
  celebrity: null
}
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  // first: the hero inside the sponsor read (the preview says so), then the round; the revision makes another round
  return replayAnswer({
    calls: asked.length === 1
      ? [
        { tool: "preview_frames", input: { ...design, hero: { ...design.hero, src: 2 } } },
        { tool: "preview_frames", input: design },
        { tool: "generate_thumbnails", input: design },
        { tool: "generate_thumbnails", input: design }
      ]
      : [{ tool: "generate_thumbnails", input: { ...design, words: "IT BROKE HIM" } }],
    result: asked.length === 1
      ? { checks: [{ option: 1, faces: 6, note: "close" }, { option: 3, faces: 9, note: "his face" }], recommended: 3 }
      : { checks: [{ option: 1, faces: 8, note: "good" }, { option: 2, faces: 7, note: "ok" }, { option: 3, faces: 5, note: "redrawn" }], recommended: 1 }
  })
})

const runtime = () =>
  ManagedRuntime.make(
    Layer.mergeAll(RunManager.layer, UsageReport.layer).pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(
        RunStore.layer,
        Artifacts.layer,
        Sources.layer,
        Projects.layer,
        ViralHome.layer,
        replay,
        ElevenLabs.layer,
        Transcriber.layer
      ))
    )
  )

test("an AI thumbnail: real frames in, three options out, the faces checked, another round with a note, and the one you choose published", async () => {
  const rt = runtime()
  const { projectId, slug } = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const artifacts = yield* Artifacts
    const sourceOwner = { _tag: "Source", id: source.id } as const
    const video = yield* artifacts.allocate(sourceOwner, "source-video")
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=30:s=320x180:r=10", join(video.dir, "source.mp4")])
    yield* artifacts.record(video, { data: null, path: join(video.relDir, "source.mp4") })
    yield* artifacts.record(yield* artifacts.allocate(sourceOwner, "ad-ranges"), {
      data: { ranges: [{ start: 0, end: 3, kind: "sponsor", evidence: "x" }] },
      path: null
    })
    const project = yield* (yield* Projects).create({ sourceIds: [source.id], title: "Candy", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    for (const kind of ["script", "voiceover", "voiceover-transcript", "shot-plan", "narrated-plan", "render", "metadata"] as const) {
      yield* artifacts.record(yield* artifacts.allocate({ _tag: "Project", id: project.id }, kind), { data: null, path: "done" })
    }
    return { projectId: project.id, slug: project.slug }
  }))

  const seen = await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const artifacts = yield* Artifacts
    const owner = { _tag: "Project", id: projectId } as const
    const run = yield* runs.start(owner, "thumbnail")
    const answered = new Set<string>()
    const nextGate = runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RequestRaised" && !answered.has(u.event.request.id)),
      Stream.runHead,
      Effect.map((u) => {
        const update = Option.getOrThrow(u)
        assert.ok(update._tag === "Event" && update.event._tag === "RequestRaised")
        answered.add(update.event.request.id)
        return update.event.request
      })
    )
    const latest = Effect.flatMap(artifacts.latest(owner, "thumbnail"), (a) => Schema.decodeUnknownEffect(Thumbnail)(Option.getOrThrow(a).data))

    const first = yield* nextGate
    const firstRound = yield* latest
    // another round, with your note
    yield* runs.respond(first.id, { _tag: "Reject", note: "Bigger words: IT BROKE HIM" })
    const second = yield* nextGate
    const secondRound = yield* latest
    // you choose option 2
    yield* runs.respond(second.id, { _tag: "Edit", artifact: { choose: 2 } })
    const finished = Option.getOrThrow(yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RunFinished"),
      Stream.runHead
    ))
    assert.ok(finished._tag === "Event" && finished.event._tag === "RunFinished")
    assert.equal(finished.event.run.status, "completed", finished.event.run.error ?? "")
    return { first, firstRound, secondRound, chosen: yield* latest }
  }))

  // the round: 2 reactions, the hero and the graphic as numbered images, sent to the skill's model at 9:16 2K high
  assert.equal(created.length, 6, "three per round, two rounds (the second generate_thumbnails call in a round makes nothing)")
  const sent = created[0]!.body
  assert.equal(sent.model_id, THUMBNAIL_IMAGE_MODEL)
  assert.deepEqual([sent.aspect_ratio, sent.resolution, sent.quality], ["9:16", "2K", "high"])
  const images = sent.images as ReadonlyArray<{ readonly type: string; readonly mime_type: string; readonly content_base64: string }>
  assert.equal(images.length, 4)
  assert.ok(images.every((i) => i.type === "inline_base64" && i.mime_type === "image/jpeg" && Buffer.from(i.content_base64, "base64").length > 1000))
  assert.match(String(sent.prompt), /Images 1 and 2 are REAL video frames of the same real person \(a bearded man/)
  assert.match(String(sent.prompt), /Copy both faces photographically from images 1 and 2/)
  assert.match(String(sent.prompt), /huge bold white "7 TASTES" text/)
  assert.ok(downloads.length > 0 && downloads.every((d) => d.key === undefined), "the signed address never gets the key")

  // the first gate: option 2 refused, 1 and 3 made, the agent's pick (3) in use
  const r1 = seen.firstRound.generated!
  assert.deepEqual(r1.options.map((o) => o.image), ["option-1.jpg", null, "option-3.jpg"])
  assert.match(r1.options[1]!.failure ?? "", /refused it: The prompt was rejected/)
  assert.deepEqual(r1.options.map((o) => o.faces), [6, null, 9])
  assert.equal(r1.recommended, 3)
  assert.equal(seen.firstRound.image, "option-3.jpg")
  assert.equal(r1.credits, 2 * 1245, "only the images made are billed")
  assert.deepEqual(r1.inputs.map((i) => [i.role, i.src]), [["reaction", 10], ["reaction", 20], ["hero", 12], ["graphic", 25]])
  const payload = seen.first.payload
  assert.ok(payload?._tag === "ThumbnailGate" && payload.config === null)
  assert.equal(payload.options?.length, 3)
  assert.equal(payload.options?.[1], null)
  assert.ok(payload.options?.[2] != null && existsSync(payload.options[2]))
  assert.equal(payload.recommended, 3)
  // the preview caught the hero in the sponsor read, then took the frames
  assert.deepEqual(asked[0]!.tools?.map((t) => t.name), ["contact_sheet", "preview_frames", "generate_thumbnails"])

  // the second round continued the conversation with your note; you chose option 2, and it's published
  assert.match(asked[1]!.message, /Revise it: Bigger words: IT BROKE HIM/)
  assert.equal(seen.secondRound.generated!.design.words, "IT BROKE HIM")
  assert.equal(seen.chosen.generated!.chosen, 2)
  assert.equal(seen.chosen.image, "option-2.jpg")
  const published = join(home, "renders", `${slug}.jpg`)
  assert.ok(existsSync(published))
  const chosenFile = readFileSync(published)
  assert.equal(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", published]).toString().trim(), "1080,1920")
  assert.ok(chosenFile.length > 0)

  // the image credits are in Settings › Usage under the thumbnail step
  const usage = await rt.runPromise(UsageReport.use((r) => r.get(1)))
  const step = usage.byStage.find((s) => s.stage === "thumbnail")
  assert.equal(step?.ttsCharacters, 5 * 1245)
  assert.ok(Math.abs((step?.costUsd ?? 0) - 1.25) < 0.01, `${step?.costUsd}`)
  await rt.dispose()
})

test("a design naming a real public figure isn't sent to the image model; the gate explains why", async () => {
  const before = created.length
  const dir = join(home, "held-back")
  const video = join(home, "clip.mp4")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=30:s=320x180:r=10", video])
  const round = await Effect.runPromise(ThumbnailImages.use((images) =>
    images.make({
      design: { ...design, celebrity: "Heidi Klum" },
      videos: [{ index: 0, path: video, source: { id: "src-held-back", origin: { _tag: "File", path: video } } as never }],
      dir,
      projectId: null,
      progress: () => Effect.void
    })
  ).pipe(Effect.provide(ThumbnailImages.layer.pipe(Layer.provideMerge(ElevenLabs.layer)))))
  assert.equal(created.length, before, "nothing sent")
  assert.deepEqual(round.options, [])
  assert.equal(round.credits, 0)
  assert.match(round.heldBack ?? "", /Heidi Klum is a real public figure, and image models block real celebrities/)
  assert.equal(round.inputs.length, 4, "the real frames are still taken, for the gate to show")
  assert.ok(round.inputs.every((i) => existsSync(join(dir, i.file))))
})
