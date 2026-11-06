import { type RunUpdate, ShotPlan } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession, type AgentTask } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { PipelineStagesLive } from "../runs/pipeline-stages.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { Sources } from "../sources/sources.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-shots-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.4 })
// the voiceover: "This guy tasted it. It hurt." at half a second a word
const VO = ["This", "guy", "tasted", "it.", "It", "hurt."].map((word, i) => w(word, i * 0.5))
const transcriptOf = (words: ReadonlyArray<{ w: string; s: number; e: number }>) => ({
  source: "x",
  language: "en",
  segments: [{ start: words[0]!.s, end: words.at(-1)!.e, text: words.map((x) => x.w).join(" "), words }]
})

// The replayed agent: first forgets the shot where the narration resumes after the insert, then fixes it.
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  const shots = [{ word: 0, src: 10, note: "him" }, { word: 2, src: 20, note: "tasting" }]
  return asked.length === 1
    ? { shots, markers: [] }
    : { shots: [...shots, { word: 4, src: 30, fit: true, note: "pain" }], markers: [{ _tag: "Circle", word: 2, x: 0.5, y: 0.5 }] }
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
        replay,
        ElevenLabs.replay(() => new Uint8Array()),
        Transcriber.layer
      ))
    )
  )

test("the shots stage places the real lines, fixes a rejected plan, and draws a storyboard", async () => {
  const rt = runtime()
  const projectId = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const artifacts = yield* Artifacts
    const sourceOwner = { _tag: "Source", id: source.id } as const
    // a 60s test video and the source run's work, as if it had run
    const video = yield* artifacts.allocate(sourceOwner, "source-video")
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=60:s=320x180:r=10", join(video.dir, "source.mp4")])
    yield* artifacts.record(video, { data: null, path: join(video.relDir, "source.mp4") })
    const tx = yield* artifacts.allocate(sourceOwner, "transcript")
    writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify(transcriptOf([w("Ow,", 40), w("that", 40.4), w("hurts.", 40.8), w("Nasty.", 50)])))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })
    yield* artifacts.record(yield* artifacts.allocate(sourceOwner, "ad-ranges"), { data: { ranges: [{ start: 0, end: 3, kind: "sponsor", evidence: "x" }] }, path: null })

    const project = yield* (yield* Projects).create({ sourceId: source.id, title: "Pain", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    const owner = { _tag: "Project", id: project.id } as const
    yield* artifacts.record(yield* artifacts.allocate(owner, "script"), {
      data: {
        headline: null,
        beats: [
          { _tag: "Narration", text: "This guy tasted it." },
          { _tag: "Real", quote: "Ow, that hurts.", start: 40, end: 41.2 },
          { _tag: "Narration", text: "It hurt." },
          { _tag: "Real", quote: "Nasty.", start: 50, end: 50.4 }
        ]
      },
      path: null
    })
    const vo = yield* artifacts.allocate(owner, "voiceover")
    yield* artifacts.record(vo, {
      data: { voiceId: "v", model: "eleven_v4", text: "x", characters: 1, rawPace: 2, atempo: 1, pace: 2, durationS: 3 },
      path: join(vo.relDir, "vo.wav")
    })
    const voTx = yield* artifacts.allocate(owner, "voiceover-transcript")
    writeFileSync(join(voTx.dir, "transcript.json"), JSON.stringify(transcriptOf(VO)))
    yield* artifacts.record(voTx, { data: null, path: join(voTx.relDir, "transcript.json") })
    return project.id
  }))

  const updates = await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Project", id: projectId }, null)
    const seen = [...yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RequestRaised"),
      Stream.runCollect
    )]
    const raised = seen.findLast((u) => u._tag === "Event" && u.event._tag === "RequestRaised")
    assert.ok(raised?._tag === "Event" && raised.event._tag === "RequestRaised")
    assert.equal(raised.event.request.title, "Approve the shots?")
    assert.equal(raised.event.request.payload?._tag, "ShotsGate")
    yield* runs.respond(raised.event.request.id, { _tag: "Approve" })
    // assemble comes next; this test stops there
    const rest = [...yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && u.event._tag === "StageStarted" && u.event.stageRun.stage === "assemble"),
      Stream.runCollect
    )]
    yield* runs.cancel(run.id)
    return rest
  }))
  const shotsDone = updates.findLast((u) => u._tag === "Event" && u.event._tag === "StageFinished" && u.event.stageRun.stage === "shots")
  assert.ok(shotsDone?._tag === "Event" && shotsDone.event._tag === "StageFinished")
  assert.equal(shotsDone.event.stageRun.status, "succeeded", shotsDone.event.stageRun.error ?? "")

  assert.equal(asked.length, 2)
  assert.match(asked[0]!.message, /REAL after word 3 "it\.": "Ow, that hurts\."/)
  assert.match(asked[1]!.message, /start a new shot on word 4 "It", where the narration resumes/)
  assert.deepEqual(asked[0]!.tools?.map((t) => t.name), ["contact_sheet"])

  const { plan, storyboard } = await rt.runPromise(Effect.gen(function*() {
    const artifacts = yield* Artifacts
    const artifact = Option.getOrThrow(yield* artifacts.latest({ _tag: "Project", id: projectId }, "shot-plan"))
    return { plan: yield* Schema.decodeUnknownEffect(ShotPlan)(artifact.data), storyboard: artifacts.resolve(artifact) }
  }))
  assert.deepEqual(plan.inserts, [
    { start: 40, end: 41.2, quote: "Ow, that hurts.", afterWord: 3, afterWordText: "it.", frame: "frames/insert-01.jpg" }
  ])
  assert.deepEqual(plan.outro, [{ start: 50, end: 50.4, quote: "Nasty.", frame: "frames/outro-01.jpg" }])
  assert.equal(plan.shots[2]!.wordText, "It")
  assert.ok(storyboard !== null && existsSync(storyboard), "the storyboard was drawn")
  // every shot and real clip has its own frame next to the storyboard
  const frames = [...plan.shots, ...plan.inserts, ...plan.outro].map((item) => item.frame)
  assert.deepEqual(frames, ["frames/shot-01.jpg", "frames/shot-02.jpg", "frames/shot-03.jpg", "frames/insert-01.jpg", "frames/outro-01.jpg"])
  for (const frame of frames) assert.ok(existsSync(join(dirname(storyboard), frame!)), `${frame} exists`)
  await rt.dispose()
})

test("the detail sheet tool refuses ranges that are too long", async () => {
  const tool = asked[0]!.tools![0]!
  const answer = await Effect.runPromise(tool.run({ start: 0, end: 500 }))
  assert.match(answer, /ask for a range of 1–60s/)
  assert.match(await Effect.runPromise(tool.run({ start: "x" })), /invalid input/)
})
