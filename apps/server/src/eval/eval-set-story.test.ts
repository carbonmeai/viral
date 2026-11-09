import { NodeServices } from "@effect/platform-node"
import { type Schema as S, Effect, Layer, ManagedRuntime, Path, Schema } from "effect"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession, type AgentTask } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { Sources } from "../sources/sources.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { reportHtml, reportMarkdown, StoredEvalReport, type EvalReport } from "./eval-report.ts"
import { parseModel, runEval } from "./eval-runner.ts"
import { exportSetFixture, loadSetFixture, SetEvalFixture, shortVideoName } from "./eval-set-fixture.ts"
import { setStoryEvalStage } from "./eval-stages.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-eval-set-"))
  process.env.VIRAL_HOME = join(home, "library")
})
after(() => rmSync(home, { recursive: true, force: true }))

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })
const transcript = (lines: ReadonlyArray<readonly [number, string]>) => ({
  source: "video.mp4",
  language: "en",
  segments: lines.map(([start, text]) => ({ start, end: start + 1, text, words: text.split(" ").map((word, i) => w(word, start + i * 0.3)) }))
})
const CANDY = transcript([[0, "Use code candy."], [200, "It worked."]])
const HEIDI = transcript([[10, "Ten or twenty hands."], [30, "I can fit inside."]])
const scores = { openLoop: 8, completionCompulsion: 7, universalRelatability: 9, shareability: 6 }

// The replayed set-story agent: first it puts Heidi's line in the candy video, then it fixes that.
const asked: Array<AgentTask<S.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  const first = asked.length === 1
  return {
    summary: "Two obsessions side by side.",
    videos: [{ video: 1, summary: "the candy build" }, { video: 2, summary: "the severed hand" }],
    beats: [
      { video: 1, beat: "result", start: 195, end: 205, summary: "it works", quotes: [{ text: "it worked", start: 200, end: 201 }] },
      { video: first ? 1 : 2, beat: "goal", start: 28, end: 35, summary: "the idea", quotes: [{ text: "I can fit inside", start: 30, end: 31 }] }
    ],
    proposals: [
      { approach: "claim-interleaved", title: "Way too far", hook: "How far?", why: "w", scores, videos: [2, 1] },
      { approach: "question-recap", title: "One reaction", hook: "Why?", why: "w", scores, videos: [1, 2] },
      { approach: "cut-down", title: "Back to back", hook: "Look.", why: "w", scores, videos: [1, 2] }
    ]
  }
})

const fixture: SetEvalFixture = {
  kind: "set",
  name: "candy-heidi",
  brief: "Two people who go too far for one reaction",
  videos: [
    { name: "Extreme candy", title: "He made the world's most extreme candy", channel: "NileBlue", durationS: 2296, transcript: CANDY, adRanges: { ranges: [{ start: 0, end: 2, kind: "sponsor", evidence: "use code" }] }, sheets: [{ file: "sheet_000.png", start: 0, end: 320 }], storySummary: "He makes a candy." },
    { name: "Heidi Klum", title: "Heidi Klum as severed hand", channel: null, durationS: 46, transcript: HEIDI, adRanges: { ranges: [] }, sheets: [], storySummary: null }
  ],
  reference: null
}

test("short video names come from the title: a name in it, else its first meaningful words", () => {
  assert.equal(shortVideoName("He made the world's most extreme candy", 0), "Extreme candy")
  assert.equal(shortVideoName("Heidi Klum as severed hand in 25th anniversary of iconic Halloween party.mp4", 1), "Heidi Klum")
  assert.equal(shortVideoName(null, 2), "Video 3")
})

test("a set-story eval runs the production task and check on the fixture, and the page shows the proposals by video", async () => {
  const dir = join(home, "fixture")
  mkdirSync(join(dir, "sheets", "v1"), { recursive: true })
  writeFileSync(join(dir, "fixture.json"), Schema.encodeSync(Schema.fromJsonString(SetEvalFixture))(fixture))

  const { results, spentUsd } = await Effect.runPromise(Effect.gen(function*() {
    const loaded = yield* loadSetFixture(dir)
    const stage = setStoryEvalStage(loaded, dir, yield* Path.Path)
    return yield* runEval({
      stages: [stage],
      models: [parseModel("gateway:anthropic/claude-haiku-5.5")!],
      runs: 1,
      budgetUsd: 1,
      billing: () => "billed",
      maxSubscriptionRuns: 0,
      onResult: () => Effect.void
    })
  }).pipe(Effect.provide(Layer.mergeAll(replay, NodeServices.layer))))

  // the agent got the set's brief, every video's lines and contact sheets, and the transcript tools
  const task = asked[0]!
  assert.equal(task.stage, "set-story")
  assert.match(task.message, /^The creator's brief for these videos: Two people who go too far/)
  assert.match(task.message, /Excluded ranges in V1 .*0–2s \(sponsor\)/)
  assert.match(task.message, /\[V2 30\.0–31\.0\] I can fit inside\./)
  assert.match(task.message, new RegExp(`${join(dir, "sheets", "v1", "sheet_000.png")}`))
  assert.deepEqual(task.tools?.map((t) => t.name), ["search_transcript", "read_transcript"])
  assert.match(asked[1]!.message, /"I can fit inside" isn't in V1's transcript/)

  const run = results[0]!
  assert.equal(run.status, "passed", run.error ?? "")
  assert.equal(run.stage, "set-story")
  assert.equal(run.firstTryPass, false)
  assert.equal(run.fixRounds, 1)
  assert.equal(spentUsd, 0)

  const report: EvalReport = {
    createdAt: "2026-11-09T12:00:00Z",
    fixture: fixture.name,
    stages: ["set-story"],
    models: [run.model],
    runs: 1,
    budgetUsd: 1,
    spentUsd,
    results,
    reference: {},
    videos: fixture.videos.map((v) => ({ name: v.name }))
  }
  const html = reportHtml(report)
  // three proposal cards side by side, each naming its videos by colour and short name
  assert.equal(html.match(/<div class=proposal>/g)?.length, 3)
  assert.match(html, /<div class=uses><span class=video><i style="background:#4f7fe0"><\/i>Extreme candy<\/span><span class=video><i style="background:#e07b32"><\/i>Heidi Klum<\/span><\/div>/)
  assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), /\bV[12]\b/)
  assert.match(html, /passed after 1 fix round/)
  assert.match(html, /isn't in Extreme candy's transcript/, "the check's problems name the videos too")
  assert.match(reportMarkdown(report), /\| set-story \| anthropic\/claude-haiku-5\.5 \| 1\/1 \| 0\/1 \| 1 \|/)

  // a report.json read back keeps the videos' names
  const stored = Schema.decodeSync(StoredEvalReport)(JSON.stringify(report))
  assert.deepEqual(stored.videos, [{ name: "Extreme candy" }, { name: "Heidi Klum" }])
})

test("exporting a set copies each video's transcript, ads and sheets, and refuses a video that isn't read", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(Sources.layer, Artifacts.layer, VideoSets.layer, ProjectSources.layer, NodeServices.layer))
  const video = (title: string, data: ReturnType<typeof transcript>, ads: boolean) =>
    Effect.gen(function*() {
      const sources = yield* Sources
      const source = yield* sources.create({ origin: { _tag: "File", path: `/videos/${title}.mp4` }, rights: "owned", rightsNote: null })
      const artifacts = yield* Artifacts
      const owner = { _tag: "Source", id: source.id } as const
      const slot = yield* artifacts.allocate(owner, "transcript")
      writeFileSync(join(slot.dir, "transcript.json"), JSON.stringify(data))
      yield* artifacts.record(slot, { data: null, path: join(slot.relDir, "transcript.json") })
      const sheets = yield* artifacts.allocate(owner, "contact-sheet")
      writeFileSync(join(sheets.dir, "sheet_000.png"), "png")
      yield* artifacts.record(sheets, { data: { every: 5, cols: 8, rows: 8, frames: 64, sheets: [{ file: "sheet_000.png", start: 0, end: 320 }] }, path: sheets.relDir })
      if (ads) yield* artifacts.record(yield* artifacts.allocate(owner, "ad-ranges"), { data: { ranges: [] }, path: null })
      return source.id
    })
  const out = join(home, "exported")
  const { exported, refused } = await rt.runPromise(Effect.gen(function*() {
    const candy = yield* video("He made the world's most extreme candy", CANDY, true)
    const heidi = yield* video("Heidi Klum as severed hand", HEIDI, true)
    const unread = yield* video("Not read", HEIDI, false)
    const sets = yield* VideoSets
    const set = yield* sets.create({ sourceIds: [candy, heidi], brief: "Too far for one reaction" })
    const other = yield* sets.create({ sourceIds: [candy, unread], brief: "Another" })
    const exported = yield* exportSetFixture({ setId: set.id, out, name: "candy-heidi", names: [] })
    const refused = yield* exportSetFixture({ setId: other.id, out: join(home, "refused"), name: "x", names: [] }).pipe(Effect.flip)
    return { exported, refused }
  }))
  await rt.dispose()
  assert.deepEqual(exported.videos.map((v) => v.name), ["Extreme candy", "Heidi Klum"])
  assert.equal(exported.brief, "Too far for one reaction")
  assert.equal(exported.reference, null)
  assert.deepEqual(exported.videos[1]!.transcript, HEIDI)
  assert.match(refused.message, /Video 2 .* has no ads result/)
  const reloaded = await Effect.runPromise(loadSetFixture(out).pipe(Effect.provide(NodeServices.layer)))
  assert.deepEqual(reloaded.videos[0]!.sheets, [{ file: "sheet_000.png", start: 0, end: 320 }])
})
