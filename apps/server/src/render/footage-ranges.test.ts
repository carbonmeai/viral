import type { CutRenderPlan, NarratedPlan, RankingRenderPlan } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { cutRanges, narratedRanges, rankingRanges } from "./footage-ranges.ts"

test("a ranking plays each shot's own stretch of its video", () => {
  const plan: RankingRenderPlan = {
    slug: "r",
    title: ["Ranking ", "X"],
    order: [2, 1],
    videos: [{ path: "a.mp4" }, { path: "b.mp4" }],
    items: [
      { rank: 1, label: "A", emoji: "🐴", shots: [{ source: 0, src: 10, dur: 3.5, framing: "window" }, { source: 0, src: 40, dur: 4, framing: "fill" }] },
      { rank: 2, label: "B", emoji: "🐮", shots: [{ source: 1, src: 5, dur: 3, framing: "window" }] }
    ]
  }
  assert.deepEqual([...rankingRanges(plan)], [
    [0, [{ start: 10, end: 13.5 }, { start: 40, end: 44 }]],
    [1, [{ start: 5, end: 8 }]]
  ])
})

test("a cut-down short plays its sections, V1 when a section names no video", () => {
  const plan: CutRenderPlan = {
    slug: "c",
    source: "a.mp4",
    transcript: "a.json",
    framing: "crop",
    sections: [{ beat: "hook", start: 12, end: 18 }, { beat: "payoff", start: 3, end: 9, source: 1 }]
  }
  assert.deepEqual([...cutRanges(plan)], [[0, [{ start: 12, end: 18 }]], [1, [{ start: 3, end: 9 }]]])
})

test("a narrated short's b-roll runs from one shot's voiceover word to the next, at the shot's speed, plus its real clips", () => {
  const words = [{ s: 0, e: 0.4 }, { s: 0.5, e: 0.9 }, { s: 1.0, e: 1.4 }, { s: 2.0, e: 2.5 }]
  const plan: NarratedPlan = {
    slug: "n",
    source: "a.mp4",
    voiceover: "vo.wav",
    voiceover_transcript: "vo.json",
    narration_end: 3,
    shots: [
      { word: 0, src: 100 },
      { word: 2, src: 50, speed: 2, source: 1 },
      { at: 2.5, src: 70 }
    ],
    inserts: [{ start: 200, end: 202, after_word: 1 }],
    outro: [{ start: 300, end: 301.5, source: 1 }]
  }
  assert.deepEqual([...narratedRanges(plan, words)], [
    [0, [{ start: 100, end: 101 }, { start: 70, end: 70.5 }, { start: 200, end: 202 }]],
    [1, [{ start: 50, end: 53 }, { start: 300, end: 301.5 }]]
  ])
})
