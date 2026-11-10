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
  home = mkdtempSync(join(tmpdir(), "viral-thumbnail-videos-"))
  process.env.VIRAL_HOME = home
  process.env.VIRAL_CUTOUT = "off"
})
after(() => rmSync(home, { recursive: true, force: true }))

// The face comes from V2 (a 640×360 video whose first 5 seconds are a sponsor read); the hero from V1.
const good = {
  background: { src: 10 },
  hero: { src: 12, crop: [0.1, 0.1, 0.9, 0.9], circle: null },
  face: { src: 20, video: 2, crop: [0.3, 0, 0.7, 1] },
  lines: [{ text: "two videos", color: "yellow" }]
}
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  return asked.length === 1 ? { ...good, face: { ...good.face, src: 2 } } : good
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

test("the thumbnail agent sees every video, a layer from V2 is checked in V2 and cut from it", async () => {
  const rt = runtime()
  const { projectId } = await rt.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const artifacts = yield* Artifacts
    const video = (color: string, size: string, ads: ReadonlyArray<{ start: number; end: number }>) =>
      Effect.gen(function*() {
        const source = yield* sources.create({ origin: { _tag: "Url", url: `https://youtu.be/${color}` }, rights: "licensed", rightsNote: null })
        const owner = { _tag: "Source", id: source.id } as const
        const slot = yield* artifacts.allocate(owner, "source-video")
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:d=30:s=${size}:r=10`, join(slot.dir, "source.mp4")])
        yield* artifacts.record(slot, { data: null, path: join(slot.relDir, "source.mp4") })
        // read already (a short's run reads its later videos first otherwise)
        for (const kind of ["transcript", "contact-sheet"] as const) {
          yield* artifacts.record(yield* artifacts.allocate(owner, kind), { data: null, path: "read" })
        }
        yield* artifacts.record(yield* artifacts.allocate(owner, "ad-ranges"), {
          data: { ranges: ads.map((r) => ({ ...r, kind: "sponsor", evidence: "x" })) },
          path: null
        })
        return source
      })
    const v1 = yield* video("red", "320x180", [])
    const v2 = yield* video("blue", "640x360", [{ start: 0, end: 5 }])
    const project = yield* (yield* Projects).create({
      sourceIds: [v1.id, v2.id],
      title: "Two",
      approach: "claim-interleaved",
      presetId: null,
      musicTrackId: null,
      brief: "use both"
    })
    for (const kind of ["script", "voiceover", "voiceover-transcript", "shot-plan", "narrated-plan", "render", "metadata"] as const) {
      yield* artifacts.record(yield* artifacts.allocate({ _tag: "Project", id: project.id }, kind), { data: null, path: "done" })
    }
    return { projectId: project.id }
  }))

  const result = await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const artifacts = yield* Artifacts
    const owner = { _tag: "Project", id: projectId } as const
    const run = yield* runs.start(owner, "thumbnail")
    const gate = Option.getOrThrow(yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RequestRaised"),
      Stream.runHead
    ))
    assert.ok(gate._tag === "Event" && gate.event._tag === "RequestRaised")
    const drafted = yield* Schema.decodeUnknownEffect(Thumbnail)(Option.getOrThrow(yield* artifacts.latest(owner, "thumbnail")).data)
    // your edit, sent without the videos: they're the short's own again
    const { sources: _sent, ...edited } = drafted.config!
    yield* runs.respond(gate.event.request.id, { _tag: "Edit", artifact: { ...edited, lines: [{ ...edited.lines[0]!, text: "TWO CLIPS" }] } })
    const finished = Option.getOrThrow(yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RunFinished"),
      Stream.runHead
    ))
    assert.ok(finished._tag === "Event" && finished.event._tag === "RunFinished")
    assert.equal(finished.event.run.status, "completed", finished.event.run.error ?? "")
    const latest = yield* Schema.decodeUnknownEffect(Thumbnail)(Option.getOrThrow(yield* artifacts.latest(owner, "thumbnail")).data)
    return { drafted, latest }
  }))

  assert.equal(asked.length, 2)
  assert.match(asked[0]!.message, /V1 "[^"]*".*frames 320×180/)
  assert.match(asked[0]!.message, /V2 "[^"]*".*frames 640×360/)
  assert.match(asked[0]!.message, /Excluded ranges in V2 \(never use\): 0\.0–5\.0s/)
  assert.match(asked[1]!.message, /the face \(V2\) at 2\.0s is inside an excluded range/)
  const { drafted, latest } = result
  assert.equal(drafted.proposal?.face?.source, 1, "stored as a position")
  assert.equal(drafted.config!.inset?.source, 1)
  assert.equal(drafted.config!.sources?.length, 1)
  assert.deepEqual(drafted.config!.inset?.box, [192, 0, 448, 360], "the face's crop in V2's 640×360 frame")
  assert.deepEqual(drafted.config!.hero.box, [32, 18, 288, 162], "the hero's in V1's 320×180 frame")
  assert.deepEqual(latest.config!.sources, drafted.config!.sources, "the edit is drawn from the short's videos")
  assert.equal(latest.config!.lines[0]?.text, "TWO CLIPS")

  // the tools take a V number
  const [sheet, preview] = asked[0]!.tools!
  const sheets = await Effect.runPromise(Effect.map(sheet!.run({ start: 10, end: 14, video: 2 }), (a) => a.text))
  assert.match(sheets, /\/v2\/10-14\/.*\(V2 10–1\ds\)/)
  assert.match(await Effect.runPromise(Effect.map(preview!.run({ ...good, face: { ...good.face, video: 3 } }), (a) => a.text)), /the face: V3 isn't one of this short's videos \(V1–V2\)/)
  const drawn = await Effect.runPromise(Effect.map(preview!.run(good), (a) => a.text))
  const file = /The draft: (\S+\.jpg)/.exec(drawn)?.[1]
  assert.ok(file !== undefined && existsSync(file), drawn)
  await rt.dispose()
})
