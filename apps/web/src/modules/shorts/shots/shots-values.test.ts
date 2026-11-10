import type { ShotPlan } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { changedShots, headlineSize, proposalOf, shotSpans, storyboardOrder, timelineShots } from "./shots-values.ts"

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.4 })
// "This guy tasted it. It hurt so much." at half a second a word
const words = ["This", "guy", "tasted", "it.", "It", "hurt", "so", "much."].map((x, i) => w(x, i * 0.5))
const plan: ShotPlan = {
  shots: [
    { word: 0, src: 10, note: "him", wordText: "This", frame: "frames/shot-01.jpg" },
    { word: 2, src: 20, note: "tasting", wordText: "tasted", frame: "frames/shot-02.jpg", fit: true },
    { word: 4, src: 30, note: "pain", wordText: "It", frame: "frames/shot-03.jpg", speed: 2 }
  ],
  markers: [],
  highlights: ["hurt"],
  inserts: [{ start: 40, end: 41.5, quote: "Ow.", afterWord: 3, afterWordText: "it.", frame: null }],
  outro: [{ start: 50, end: 51, quote: "Nasty.", frame: null }],
  storyboard: null
}

test("each shot runs from its word to the next shot's word, the last to the end of the voiceover", () => {
  assert.deepEqual(shotSpans(plan, words, 4), [{ k: 0, from: 0, to: 1 }, { k: 1, from: 1, to: 2 }, { k: 2, from: 2, to: 4 }])
})

test("on the short's timeline, shots after a real line move later by its length", () => {
  // the real line plays after "it." (ends at 1.9 s) for 1.5 s
  const layout = { pauses: [{ at: 1.9, dur: 1.5, source: 0 }] }
  const blocks = timelineShots(shotSpans(plan, words, 4), layout)
  assert.deepEqual(blocks.map((b) => [b.k, +b.start.toFixed(2), +b.end.toFixed(2)]), [
    [0, 0, 1],
    // shot 2 is cut by the real line: 1–1.9 before it, then 1.9–2 after it (shifted by 1.5)
    [1, 1, 1.9],
    [1, 3.4, 3.5],
    [2, 3.5, 5.5]
  ])
})

test("a skipped stretch of voiceover is never on screen; shots after it move by the clip less the skip", () => {
  // the real line plays after 1.9 s for 1.5 s, then the voiceover picks up at 2.5 (0.6 s skipped)
  const layout = { pauses: [{ at: 1.9, dur: 1.5, source: 0, skip: 0.6 }] }
  const blocks = timelineShots(shotSpans(plan, words, 4), layout)
  assert.deepEqual(blocks.map((b) => [b.k, +b.start.toFixed(2), +b.end.toFixed(2)]), [
    [0, 0, 1],
    [1, 1, 1.9],
    // shot 3 (from 2 s) loses 2–2.5, which is skipped, and plays from where the narration picks up
    [2, 3.4, 4.9]
  ])
})

test("the storyboard plays the real lines where they cut in, and the outro last", () => {
  assert.deepEqual(storyboardOrder(plan), [
    { _tag: "Shot", k: 0 },
    { _tag: "Shot", k: 1 },
    { _tag: "Real", kind: "insert", index: 0 },
    { _tag: "Shot", k: 2 },
    { _tag: "Real", kind: "outro", index: 0 }
  ])
})

test("a draft becomes the edited shot list, and only real changes count", () => {
  const draft = new Map([
    [0, { src: 12, still: "frames-around/12000.jpg" }],
    [1, { fit: true }],
    [2, { speed: 1 }]
  ])
  assert.equal(changedShots(plan, draft), 2, "shot 2 already showed the whole frame; shots 1 and 3 changed")
  const proposal = proposalOf(plan, draft)
  assert.deepEqual(proposal.shots, [
    { word: 0, src: 12, note: "him" },
    { word: 2, src: 20, note: "tasting", fit: true },
    { word: 4, src: 30, note: "pain" }
  ])
  assert.deepEqual(proposal.highlights, ["hurt"])
})

test("a headline line is sized like the renderer: capped by the style, shrunk to fit the width", () => {
  assert.equal(headlineSize("ONE CANDY", 0, 0.13), 13, "a short first line takes the style's size")
  assert.ok(Math.abs(headlineSize("AB", 1, 0.13) - 7.8) < 1e-9, "later lines are capped at 60% of it")
  assert.ok(headlineSize("EVERY TASTE IN ONE BITE", 0, 0.13) < 13, "a long line shrinks to fit the width")
})

test("a shot keeps its video in the edit, and a frame picked from another video moves it there", () => {
  const multi: ShotPlan = { ...plan, shots: [plan.shots[0]!, { ...plan.shots[1]!, source: 1 }, plan.shots[2]!] }
  // untouched, the V2 shot stays V2 and V1 shots carry no source
  assert.deepEqual(proposalOf(multi, new Map()).shots.map((s) => s.source), [undefined, 1, undefined])
  assert.equal(changedShots(multi, new Map([[1, { source: 1 }]])), 0)
  // a frame from V2 for shot 1; a frame from V1 for the V2 shot
  const draft = new Map([[0, { src: 12, source: 1, still: "frames-around/12000.jpg" }], [1, { src: 5, source: 0 }]])
  const edited = proposalOf(multi, draft).shots
  assert.deepEqual(edited.map((s) => [s.src, s.source]), [[12, 1], [5, undefined], [30, undefined]])
  assert.equal(changedShots(multi, draft), 2)
})
