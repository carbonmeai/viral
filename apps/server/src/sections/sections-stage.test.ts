import { CutPlan, CutRenderPlan, type RunUpdate } from "@viral/contracts"
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
  home = mkdtempSync(join(tmpdir(), "viral-sections-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

// a word every half second for the whole minute: "w0 w1 …"
const words = Array.from({ length: 120 }, (_, i) => ({ w: `w${i}`, s: i * 0.5, e: i * 0.5 + 0.4 }))

// The replayed agent: first a plan that doesn't open on the hook, then a fixed one.
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  const sections = [
    { beat: "rising_action", start: 5, end: 15, note: "the goal" },
    { beat: "payoff", start: 40, end: 48, note: "the result" }
  ]
  return asked.length === 1
    ? { hookText: "Does it work?", sections }
    : { hookText: "Does it work?", sections: [{ beat: "hook", start: 50, end: 53, note: "the line" }, ...sections] }
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

test("the sections stage fixes a rejected plan, snaps it to words and draws a storyboard; assemble styles it", async () => {
  const rt = runtime()
  const projectId = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "licensed", rightsNote: null })
    yield* (yield* Sources).setDetails(source.id, "Test video", "Tester")
    const artifacts = yield* Artifacts
    const owner = { _tag: "Source", id: source.id } as const
    const video = yield* artifacts.allocate(owner, "source-video")
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=60:s=320x180:r=10", join(video.dir, "source.mp4")])
    yield* artifacts.record(video, { data: null, path: join(video.relDir, "source.mp4") })
    const tx = yield* artifacts.allocate(owner, "transcript")
    writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify({
      source: "x",
      language: "en",
      segments: [{ start: 0, end: 60, text: words.map((w) => w.w).join(" "), words }]
    }))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })
    yield* artifacts.record(yield* artifacts.allocate(owner, "ad-ranges"), { data: { ranges: [{ start: 0, end: 2, kind: "sponsor", evidence: "x" }] }, path: null })
    const project = yield* (yield* Projects).create({ sourceId: source.id, title: "Cut", approach: "cut-down", presetId: null, musicTrackId: null })
    return project.id
  }))

  await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Project", id: projectId }, null)
    const gate = yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && (u.event._tag === "RequestRaised" || u.event._tag === "RunFinished")),
      Stream.runHead,
      Effect.map(Option.getOrThrow)
    )
    assert.ok(gate._tag === "Event" && gate.event._tag === "RequestRaised", JSON.stringify(gate._tag === "Event" && gate.event._tag === "RunFinished" ? gate.event.run.error : gate))
    assert.equal(gate.event.request.title, "Approve the sections?")
    assert.equal(gate.event.request.payload?._tag, "SectionsGate")
    yield* runs.respond(gate.event.request.id, { _tag: "Approve" })
    // assemble runs next; the render after it has its own test, so this one stops there
    yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && u.event._tag === "StageStarted" && u.event.stageRun.stage === "render"),
      Stream.runHead
    )
    yield* runs.cancel(run.id)
  }))

  assert.equal(asked.length, 2)
  assert.deepEqual(asked[0]!.tools?.map((t) => t.name), ["contact_sheet", "preview_sections"])
  assert.match(asked[1]!.message, /first section must be the hook/)

  const { plan, storyboard, rendered } = await rt.runPromise(Effect.gen(function*() {
    const artifacts = yield* Artifacts
    const owner = { _tag: "Project", id: projectId } as const
    const cut = Option.getOrThrow(yield* artifacts.latest(owner, "cut-plan"))
    const render = Option.getOrThrow(yield* artifacts.latest(owner, "cut-render-plan"))
    return {
      plan: yield* Schema.decodeUnknownEffect(CutPlan)(cut.data),
      storyboard: artifacts.resolve(cut),
      rendered: yield* Schema.decodeUnknownEffect(CutRenderPlan)(render.data)
    }
  }))
  // snapped to whole words: 50.0 starts w100; 53.0 falls between w105 (ends 52.9) and w106 (starts 53.0)
  assert.deepEqual([plan.sections[0]!.start, plan.sections[0]!.end], [50 - 0.06, 53])
  assert.match(plan.sections[0]!.text, /^w100 w101/)
  assert.ok(storyboard !== null && existsSync(storyboard), "the storyboard was drawn")
  assert.ok(existsSync(join(dirname(storyboard), plan.sections[0]!.frame!)), "each section has its own frame")
  // the default style: a blurred fill, no hook card, and the credit only for styles that show one
  assert.equal(rendered.framing, "blur")
  assert.equal(rendered.hook_text, undefined)
  assert.equal(rendered.sections.length, 3)
  assert.deepEqual(rendered.exclude, [[0, 2]])
  assert.equal(rendered.snap, false, "the renderer plays the snapped times as they are")
  await rt.dispose()
})
