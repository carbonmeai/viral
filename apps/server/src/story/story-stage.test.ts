import { type RunUpdate, StoryMap } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession, type AgentTask } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { PipelineStagesLive } from "../runs/pipeline-stages.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { Sources } from "../sources/sources.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-story-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })
const TRANSCRIPT = {
  source: "candy.mp4",
  language: "en",
  segments: [
    { start: 0, end: 1, text: "Use code candy.", words: [w("Use", 0), w("code", 0.3), w("candy.", 0.6)] },
    { start: 200, end: 201, text: "It worked.", words: [w("It", 200), w("worked.", 200.3)] }
  ]
}
const scores = { openLoop: 8, completionCompulsion: 7, universalRelatability: 9, shareability: 6 }
const proposal = (approach: string, title: string) => ({ approach, title, hook: `${title}?`, why: "w", scores })

// The replayed agents: the ads agent finds the sponsor read; the story agent first quotes it, then fixes that.
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  if (task.stage === "ads") return { ranges: [{ start: 0, end: 1, kind: "sponsor", evidence: "use code" }] }
  const quote = asked.filter((t) => t.stage === "story").length === 1
    ? { text: "use code candy", start: 0, end: 1 }
    : { text: "it worked", start: 200, end: 201 }
  return {
    summary: "He makes the most extreme candy.",
    beats: [{ beat: "result", start: 190, end: 210, summary: "it works", quotes: [quote] }],
    proposals: [proposal("claim-interleaved", "Every taste"), proposal("question-recap", "What if"), proposal("cut-down", "Cut")]
  }
})

const runtime = () =>
  ManagedRuntime.make(
    RunManager.layer.pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(RunStore.layer, Artifacts.layer, Sources.layer, Projects.layer, replay))
    )
  )

test("a source run finds the ads, maps the story with 3 proposals, and a proposal becomes a short", async () => {
  const rt = runtime()
  const sourceId = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    // the first three stages' artifacts, as if they had run
    const artifacts = yield* Artifacts
    const owner = { _tag: "Source", id: source.id } as const
    yield* artifacts.record(yield* artifacts.allocate(owner, "source-video"), { data: null, path: "source.mp4" })
    const slot = yield* artifacts.allocate(owner, "transcript")
    writeFileSync(join(slot.dir, "transcript.json"), JSON.stringify(TRANSCRIPT))
    yield* artifacts.record(slot, { data: null, path: join(slot.relDir, "transcript.json") })
    yield* artifacts.record(yield* artifacts.allocate(owner, "contact-sheet"), { data: { every: 5, cols: 8, rows: 8, frames: 0, sheets: [] }, path: null })
    return source.id
  }))

  const updates = await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Source", id: sourceId }, null)
    return [...yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RunFinished"),
      Stream.runCollect
    )]
  }))
  const finished = updates.findLast((u) => u._tag === "Event" && u.event._tag === "RunFinished")
  assert.ok(finished?._tag === "Event" && finished.event._tag === "RunFinished")
  assert.equal(finished.event.run.status, "completed", finished.event.run.error ?? "")

  const stories = asked.filter((t) => t.stage === "story")
  assert.equal(stories.length, 2, "the story agent was asked to fix its quote")
  assert.match(stories[0]!.message, /Excluded ranges.*0–2s \(sponsor\)/, "the padded ad range reached the brief")
  assert.match(stories[1]!.message, /"use code candy" is inside an ad/)

  const project = await rt.runPromise(Effect.gen(function*() {
    const artifact = Option.getOrThrow(yield* (yield* Artifacts).latest({ _tag: "Source", id: sourceId }, "story-map"))
    const map = yield* Schema.decodeUnknownEffect(StoryMap)(artifact.data)
    assert.deepEqual(map.beats[0]!.quotes[0], { text: "It worked.", start: 199.95, end: 200.75 })
    const projects = yield* Projects
    const missing = yield* projects.fromProposal(sourceId, 3).pipe(Effect.flip)
    assert.equal(missing._tag, "ProposalNotFound")
    return yield* projects.fromProposal(sourceId, 1)
  }))
  assert.equal(project.approach, "question-recap")
  assert.equal(project.title, "What if")
  await rt.dispose()
})
