import type { StageRun, StoryBeat } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { duration, framesOf, modelName, runSpend, isVideoLink, nearestStill, proposalStillTime, shortForProposal, stageDetail, stepState, storyStrip } from "./video-values.ts"

const beat = (b: StoryBeat["beat"], start: number, end: number): StoryBeat => ({ beat: b, start, end, summary: b, quotes: [] })

test("the story strip places beats and kept-out ranges along the video", () => {
  const strip = storyStrip([beat("goal", 0, 100), beat("result", 900, 1000)], [{ start: 950, end: 1000, kind: "sponsor", evidence: "x" }], 1000)
  assert.deepEqual(strip.beats.map((b) => [b.left, b.width]), [[0, 10], [90, 10]])
  assert.deepEqual(strip.ads.map((a) => [a.left, a.width]), [[95, 5]])
  assert.deepEqual(storyStrip([beat("goal", 0, 1)], [], 0), { beats: [], ads: [] }, "no length, no strip")
})

test("a stage's state and its Detailed-mode numbers", () => {
  assert.equal(stepState(undefined), "next")
  assert.equal(stepState({ status: "reused" } as StageRun), "done")
  assert.equal(stepState({ status: "cancelled" } as StageRun), "failed")
  const run = { model: "claude-haiku-4-5", costUsd: 0.112, ttsCharacters: null, durationMs: 18_500 } as StageRun
  assert.equal(stageDetail({ ...run, model: "claude-haiku-4-5-20251001", ttsCharacters: 0 }), "Haiku 4.5 · $0.11 · 18.5s", "no characters when none were spoken")
  assert.equal(modelName("claude-opus-5-5[1m]"), "Opus 5.5")
  assert.equal(modelName("eleven_v4"), "eleven_v4")
  const spend = runSpend([{ ...run, model: "claude-haiku-4-5-20251001" }, { ...run, model: "claude-opus-5-5[1m]", costUsd: 0.43 }, { ...run, costUsd: null }])
  assert.equal(spend.split, "Haiku 4.5 $0.11 · Opus 5.5 $0.43")
  assert.ok(Math.abs(spend.total - 0.542) < 1e-9)
  assert.equal(duration(123_000), "2 min 3s")
})

test("each proposal's card gets a still from a different part of the story", () => {
  const beats = [beat("goal", 0, 10), beat("process", 10, 20), beat("result", 20, 30)]
  assert.deepEqual([0, 1, 2].map((i) => proposalStillTime(beats, i, 30)), [5, 15, 25])
  const stills = [{ t: 0 }, { t: 5 }, { t: 10 }]
  assert.deepEqual(nearestStill(stills, 6), { t: 5 })
  assert.equal(nearestStill([], 6), null)
})

test("a video link is any http(s) link", () => {
  assert.equal(isVideoLink("https://www.youtube.com/watch?v=abc"), true)
  assert.equal(isVideoLink(" /Users/me/video.mp4"), false)
})

test("frames come from single files, or from contact-sheet tiles on older sheets", () => {
  const withStills = framesOf({ every: 5, cols: 8, rows: 8, frames: 2, sheets: [], stills: [{ file: "frames/a.jpg", t: 0 }, { file: "frames/b.jpg", t: 5 }] })
  assert.deepEqual(withStills.map((f) => [f.file, f.tile]), [["frames/a.jpg", null], ["frames/b.jpg", null]])
  // 10 frames on a 4-wide sheet: 3 rows; frame 5 is column 1 of row 1
  const tiles = framesOf({ every: 5, cols: 4, rows: 8, frames: 10, sheets: [{ file: "sheet_000.png", start: 0, end: 45 }] })
  assert.equal(tiles.length, 10)
  assert.deepEqual(tiles[5], { t: 25, file: "sheet_000.png", tile: { col: 1, row: 1, cols: 4, rows: 3 } })
})

test("a proposal opens the short made from it, its exact title first", () => {
  const short = (title: string, proposal: number | null) => ({ project: { title } as never, proposal })
  const shorts = [short("Every taste candy", 0), short("He Made a Candy", 0), short("Other", 1)]
  assert.equal(shortForProposal(shorts, 0, "He Made a Candy")?.project.title, "He Made a Candy")
  assert.equal(shortForProposal(shorts, 0, "Renamed")?.project.title, "Every taste candy")
  assert.equal(shortForProposal(shorts, 2, "x"), null)
})
