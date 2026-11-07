import { Effect, Layer, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { RunStore } from "../runs/run-store.ts"
import { SourceOverviews } from "./source-overview.ts"
import { Sources } from "./sources.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-overview-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const scores = { openLoop: 8, completionCompulsion: 7, universalRelatability: 8, shareability: 7 }
const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })

test("a video's overview gathers its run, story, ads, frames, transcript and shorts", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(SourceOverviews.layer, Sources.layer, Artifacts.layer, Projects.layer, RunStore.layer))
  const { sourceId, empty } = await rt.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const source = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "unconfirmed", rightsNote: null })
    const empty = yield* (yield* SourceOverviews).get(source.id)

    const owner = { _tag: "Source", id: source.id } as const
    const store = yield* RunStore
    const run = yield* store.createRun(owner, null)
    yield* store.createStageRun(run.id, "source", 1, "succeeded")
    yield* store.createStageRun(run.id, "transcribe", 1, "running")

    const artifacts = yield* Artifacts
    const record = (kind: "story-map" | "ad-ranges" | "contact-sheet", data: unknown) =>
      Effect.flatMap(artifacts.allocate(owner, kind), (slot) => artifacts.record(slot, { data, path: null }))
    yield* record("story-map", {
      summary: "Candy.",
      beats: [{ beat: "result", start: 10, end: 20, summary: "it works", quotes: [] }],
      proposals: [
        { approach: "claim-interleaved", title: "Every taste", hook: "h", why: "w", scores },
        { approach: "cut-down", title: "Cut", hook: "h", why: "w", scores }
      ]
    })
    yield* record("ad-ranges", { ranges: [{ start: 0, end: 3, kind: "sponsor", evidence: "sponsored by" }] })
    yield* record("contact-sheet", {
      every: 5, cols: 8, rows: 8, frames: 2, sheets: [{ file: "sheet_000.png", start: 0, end: 5 }],
      stills: [{ file: "frames/frame_00000.jpg", t: 0 }, { file: "frames/frame_00001.jpg", t: 5 }]
    })
    const tx = yield* artifacts.allocate(owner, "transcript")
    writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify({
      source: "x", language: "en", provider: "grok",
      segments: [{ start: 1, end: 2, text: "It worked.", words: [w("It", 1), w("worked.", 1.3)] }]
    }))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })
    yield* (yield* Projects).create({ sourceIds: [source.id], title: "Every taste", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    return { sourceId: source.id, empty }
  }))

  assert.equal(empty.run, null, "a new video has no run yet")
  assert.deepEqual([empty.story, empty.contactSheet, empty.transcript, empty.ads, empty.shorts], [null, null, null, [], []])

  const overview = await rt.runPromise(Effect.gen(function*() {
    return yield* (yield* SourceOverviews).get(sourceId)
  }))
  assert.equal(overview.run?.status, "running")
  assert.deepEqual(overview.stages.map((s) => `${s.stage}:${s.status}`), ["source:succeeded", "transcribe:running"])
  assert.equal(overview.story?.proposals.length, 2)
  assert.deepEqual(overview.ads.map((a) => a.kind), ["sponsor"])
  assert.equal(overview.contactSheet?.version, 1)
  assert.equal(overview.contactSheet?.set.stills?.length, 2)
  assert.deepEqual(overview.transcript, { provider: "grok", words: 2, lines: [{ start: 1, end: 2, text: "It worked." }] })
  assert.deepEqual(overview.shorts.map((s) => [s.project.title, s.proposal]), [["Every taste", 0]])
  await rt.dispose()
})
