import { type RunUpdate, Thumbnail } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
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
import { ElevenLabs } from "../voice/eleven-labs.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-thumbnail-"))
  process.env.VIRAL_HOME = home
  // the default (bold) layout draws without cut-outs here: no model download in tests
  process.env.VIRAL_CUTOUT = "off"
})
after(() => rmSync(home, { recursive: true, force: true }))

const good = {
  background: { src: 10 },
  hero: { src: 12, crop: [0.1, 0.1, 0.9, 0.9], circle: { x: 0.5, y: 0.5, r: 0.3 } },
  face: { src: 20, crop: [0.3, 0, 0.8, 1] },
  lines: [{ text: "7 tastes", color: "yellow" }, { text: "1 candy", color: "white" }]
}
// The replayed agent: first a hero inside the sponsor read, then the fixed thumbnail.
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  return asked.length === 1 ? { ...good, hero: { ...good.hero, src: 2 } } : good
})

const runtime = () =>
  ManagedRuntime.make(
    RunManager.layer.pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(
        RunStore.layer,
        Artifacts.layer,
        Sources.layer,
        Projects.layer,
        ViralHome.layer,
        replay,
        ElevenLabs.replay(() => new Uint8Array()),
        Transcriber.layer
      ))
    )
  )

test("the thumbnail stage fixes a rejected draft, takes an edit, and publishes the jpg once approved", async () => {
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
    // every earlier step of the short is done
    for (const kind of ["script", "voiceover", "voiceover-transcript", "shot-plan", "narrated-plan", "render", "metadata"] as const) {
      yield* artifacts.record(yield* artifacts.allocate({ _tag: "Project", id: project.id }, kind), { data: null, path: "done" })
    }
    return { projectId: project.id, slug: project.slug }
  }))

  const thumbnails = await rt.runPromise(Effect.gen(function*() {
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
    const gate = yield* nextGate
    assert.equal(gate.payload?._tag, "ThumbnailGate")
    assert.ok(gate.payload?._tag === "ThumbnailGate" && gate.payload.image !== null && existsSync(gate.payload.image))
    const drafted = yield* Schema.decodeUnknownEffect(Thumbnail)(Option.getOrThrow(yield* artifacts.latest(owner, "thumbnail")).data)
    // your edit: one word changed in the config
    const edited = { ...drafted.config, lines: [{ ...drafted.config.lines[0]!, text: "8 TASTES" }, drafted.config.lines[1]!] }
    yield* runs.respond(gate.id, { _tag: "Edit", artifact: edited })
    const finished = yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RunFinished"),
      Stream.runHead
    )
    const event = Option.getOrThrow(finished)
    assert.ok(event._tag === "Event" && event.event._tag === "RunFinished")
    assert.equal(event.event.run.status, "completed", event.event.run.error ?? "")
    const latest = yield* Schema.decodeUnknownEffect(Thumbnail)(Option.getOrThrow(yield* artifacts.latest(owner, "thumbnail")).data)
    return { drafted, latest }
  }))

  assert.equal(asked.length, 2, "the agent was asked to fix its draft")
  assert.match(asked[1]!.message, /the hero at 2\.0s is inside an excluded range/)
  assert.deepEqual(asked[0]!.tools?.map((t) => t.name), ["contact_sheet", "preview_thumbnail", "tell_creator"])
  assert.deepEqual(thumbnails.drafted.config.hero.box, [32, 18, 288, 162], "fraction crops became pixels of the 320×180 video")
  assert.equal(thumbnails.latest.proposal, null, "the edit is recorded as your config")
  assert.equal(thumbnails.latest.config.lines[0]?.text, "8 TASTES")
  const published = await rt.runPromise(Effect.map(ViralHome, (h) => join(h.renders, `${slug}.jpg`)))
  assert.ok(existsSync(published), "approved, so the jpg is published next to the short")
  await rt.dispose()
})

test("the preview tool reports problems first, then draws the draft", async () => {
  const preview = asked[0]!.tools![1]!
  assert.match(await Effect.runPromise(Effect.map(preview.run({ ...good, lines: [{ text: "one", color: "yellow" }] }), (a) => a.text)), /the text is 1 words/)
  const drawn = await Effect.runPromise(Effect.map(preview.run(good), (a) => a.text))
  const file = /The draft: (\S+\.jpg)/.exec(drawn)?.[1]
  assert.ok(file !== undefined && existsSync(file), drawn)
})
