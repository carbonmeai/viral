import { type RunUpdate, SetStory, type SourceId } from "@viral/contracts"
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
import { Transcriber } from "../transcribe/transcriber.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-set-story-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })
const transcript = (lines: ReadonlyArray<readonly [number, string]>) => ({
  source: "video.mp4",
  language: "en",
  segments: lines.map(([start, text]) => ({ start, end: start + 1, text, words: text.split(" ").map((word, i) => w(word, start + i * 0.3)) }))
})
// V1 has a sponsor read; both videos say "it worked", at different times
const FIRST = transcript([[0, "Use code candy."], [200, "It worked."]])
const SECOND = transcript([[30, "Never again."], [90, "It worked."]])
const scores = { openLoop: 8, completionCompulsion: 7, universalRelatability: 9, shareability: 6 }
const proposal = (approach: string, title: string, videos: ReadonlyArray<number>) => ({ approach, title, hook: `${title}?`, why: "w", scores, videos })

// The replayed agents: the ads agent finds V1's sponsor read; the set-story agent first puts V2's line in V1, then
// fixes that.
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  if (task.stage === "ads") return { ranges: [{ start: 0, end: 1, kind: "sponsor", evidence: "use code" }] }
  const first = asked.filter((t) => t.stage === "set-story").length === 1
  return {
    summary: "Two tries at the same candy.",
    videos: [{ video: 1, summary: "the first try" }, { video: 2, summary: "the second try" }],
    beats: [
      { video: 1, beat: "result", start: 190, end: 210, summary: "it works", quotes: [{ text: "it worked", start: 200, end: 201 }] },
      { video: first ? 1 : 2, beat: "reaction", start: 25, end: 35, summary: "never again", quotes: [{ text: "never again", start: 30, end: 31 }] }
    ],
    proposals: [
      proposal("claim-interleaved", "Two tries", [1, 2]),
      proposal("question-recap", "Which worked", [2, 1]),
      proposal("cut-down", "Back to back", [1, 2])
    ]
  }
})

const NoVoice = Layer.mergeAll(ElevenLabs.replay(() => new Uint8Array()), Transcriber.layer)

const runtime = () =>
  ManagedRuntime.make(
    RunManager.layer.pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(RunStore.layer, Artifacts.layer, Sources.layer, Projects.layer, VideoSets.layer, replay, NoVoice))
    )
  )

// A video as if its source run had fetched, transcribed and looked at it (and, with `ads`, found its ads).
const readVideo = (data: ReturnType<typeof transcript>, ads: boolean) =>
  Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const artifacts = yield* Artifacts
    const owner = { _tag: "Source", id: source.id } as const
    yield* artifacts.record(yield* artifacts.allocate(owner, "source-video"), { data: null, path: "source.mp4" })
    const slot = yield* artifacts.allocate(owner, "transcript")
    writeFileSync(join(slot.dir, "transcript.json"), JSON.stringify(data))
    yield* artifacts.record(slot, { data: null, path: join(slot.relDir, "transcript.json") })
    yield* artifacts.record(yield* artifacts.allocate(owner, "contact-sheet"), { data: { every: 5, cols: 8, rows: 8, frames: 0, sheets: [] }, path: null })
    if (ads) yield* artifacts.record(yield* artifacts.allocate(owner, "ad-ranges"), { data: { ranges: [] }, path: null })
    return source.id
  })

test("a set run reads the videos that need it, proposes shorts across them, and a proposal becomes a short", async () => {
  const rt = runtime()
  const { setId, first, second } = await rt.runPromise(Effect.gen(function*() {
    const first: SourceId = yield* readVideo(FIRST, false)
    const second: SourceId = yield* readVideo(SECOND, true)
    const set = yield* (yield* VideoSets).create({ sourceIds: [first, second], brief: "Compare both tries at the candy" })
    return { setId: set.id, first, second }
  }))

  const updates = await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Set", id: setId }, null)
    return [...yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RunFinished"),
      Stream.runCollect
    )]
  }))
  const finished = updates.findLast((u) => u._tag === "Event" && u.event._tag === "RunFinished")
  assert.ok(finished?._tag === "Event" && finished.event._tag === "RunFinished")
  assert.equal(finished.event.run.status, "completed", finished.event.run.error ?? "")

  // V1 needed its ads, in its own source run that stops before the video's own story; V2 was already read
  const { firstRuns, secondRuns, firstStages } = await rt.runPromise(Effect.gen(function*() {
    const store = yield* RunStore
    const firstRuns = yield* store.listRuns({ _tag: "Source", id: first })
    const secondRuns = yield* store.listRuns({ _tag: "Source", id: second })
    const firstStages = firstRuns.length === 0 ? [] : yield* store.listStageRuns(firstRuns[0]!.id)
    return { firstRuns, secondRuns, firstStages }
  }))
  assert.equal(firstRuns.length, 1)
  assert.equal(firstRuns[0]!.status, "completed")
  // stage runs made in the same millisecond have no order, so compare them as a set
  assert.deepEqual(Object.fromEntries(firstStages.map((s) => [s.stage, s.status])), {
    source: "reused",
    transcribe: "reused",
    "contact-sheet": "reused",
    ads: "succeeded"
  })
  assert.equal(secondRuns.length, 0)
  assert.equal(asked.filter((t) => t.stage === "story").length, 0, "no single-video story")

  const stories = asked.filter((t) => t.stage === "set-story")
  assert.equal(stories.length, 2, "the set-story agent was asked to fix its quote")
  const brief = stories[0]!.message
  assert.match(brief, /^The creator's brief for these videos: Compare both tries at the candy/)
  assert.match(brief, /Excluded ranges in V1 .*0–2s \(sponsor\)/)
  assert.match(brief, /\[V2 90\.0–91\.0\] It worked\./)
  assert.deepEqual(stories[0]!.tools?.map((t) => t.name), ["search_transcript", "read_transcript"])
  assert.match(stories[1]!.message, /"never again" isn't in V1's transcript/)

  const { story, project, missing } = await rt.runPromise(Effect.gen(function*() {
    const artifact = Option.getOrThrow(yield* (yield* Artifacts).latest({ _tag: "Set", id: setId }, "set-story"))
    const story = yield* Schema.decodeUnknownEffect(SetStory)(artifact.data)
    const projects = yield* Projects
    const missing = yield* projects.fromSetProposal(setId, 3).pipe(Effect.flip)
    const project = yield* projects.fromSetProposal(setId, 1)
    return { story, project, missing }
  }))
  assert.deepEqual(story.beats.map((b) => [b.source, b.quotes[0]]), [
    [0, { text: "It worked.", start: 199.95, end: 200.75 }],
    [1, { text: "Never again.", start: 29.95, end: 30.75 }]
  ])
  assert.deepEqual(story.proposals[1]!.sources, [0, 1])
  assert.equal(missing._tag, "SetProposalNotFound")
  assert.equal(project.title, "Which worked")
  assert.equal(project.approach, "question-recap")
  assert.deepEqual(project.sourceIds, [first, second], "the proposal's videos, in set order")
  assert.equal(project.brief, "Compare both tries at the candy", "the set's brief")
  assert.equal(project.setId, setId)
  await rt.dispose()
})
