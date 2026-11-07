import type { MusicArrangement } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { barGrid, checkArrangement, planArrangement, wordStartsInShort } from "./music-arrangement.ts"

// 120 BPM (2 s bars), drop at 9 s in a 30 s song: bar 0 starts at 1 s, the drop is bar 4, 14 whole bars
const ctx = {
  barS: 2,
  songDropS: 9,
  songDurationS: 30,
  dropWord: 3,
  words: Array.from({ length: 20 }, (_, i) => ({ w: `w${i}`, s: i })),
  durationS: 20
}
const blocks = (...b: MusicArrangement["blocks"]): MusicArrangement => ({ blocks: b })

test("the bar grid counts bar 0 as the earliest whole bar before the drop", () => {
  assert.deepEqual(barGrid(2, 9, 30), { dropBar: 4, origin: 1, songBars: 14 })
  assert.deepEqual(barGrid(2, 8, null), { dropBar: 4, origin: 0, songBars: null })
})

test("a playable arrangement has no problems", () => {
  assert.deepEqual(checkArrangement(blocks(
    { fromBar: 0, toBar: 2, loops: 1, start: "after" },
    { fromBar: 4, toBar: 8, loops: 1, start: "drop" },
    { fromBar: 10, toBar: 12, loops: 2, start: { word: 12 } }
  ), ctx), [])
})

test("blocks that can't be heard are named", () => {
  // after the drop (3 s) the 8 s block runs past word 6, where the next pin starts
  assert.deepEqual(checkArrangement(blocks(
    { fromBar: 4, toBar: 8, loops: 1, start: "drop" },
    { fromBar: 0, toBar: 1, loops: 1, start: "after" },
    { fromBar: 8, toBar: 9, loops: 1, start: { word: 6 } }
  ), ctx), ["block 2 won't be heard: block 3 is pinned to start at 6.00s, before it would begin"])
  // before the first pin, the blocks end on it: two bars already fill the 3 s, so the first is never heard
  assert.deepEqual(checkArrangement(blocks(
    { fromBar: 0, toBar: 1, loops: 1, start: "after" },
    { fromBar: 1, toBar: 3, loops: 1, start: "after" },
    { fromBar: 4, toBar: 5, loops: 1, start: "drop" }
  ), ctx), ["block 1 won't be heard: the blocks after it already fill the start before block 3"])
})

test("a drop start needs a drop word, and an empty arrangement is refused", () => {
  assert.deepEqual(checkArrangement(blocks({ fromBar: 4, toBar: 5, loops: 1, start: "drop" }), { ...ctx, dropWord: null }), [
    "block 1 starts on the drop word, but this short has none"
  ])
  assert.deepEqual(checkArrangement(blocks(), ctx), ["the arrangement has no blocks; use the automatic one instead"])
})

test("the plan's arrangement is snake_case with the drop start turned into the drop word", () => {
  assert.deepEqual(planArrangement(blocks(
    { fromBar: 0, toBar: 2, loops: 3, start: "after" },
    { fromBar: 4, toBar: 6, loops: 1, start: "drop" },
    { fromBar: 4, toBar: 5, loops: 1, start: { word: 9 } }
  ), 3), [
    { from_bar: 0, to_bar: 2, loops: 3 },
    { from_bar: 4, to_bar: 6, loops: 1, word: 3 },
    { from_bar: 4, to_bar: 5, loops: 1, word: 9 }
  ])
})

test("an insert pushes the words after it later in the short", () => {
  const words = [{ w: "a", s: 0, e: 0.5 }, { w: "b", s: 1, e: 1.5 }, { w: "c", s: 2, e: 2.5 }]
  const plan = { slug: "x", source: "", voiceover: "", voiceover_transcript: "", shots: [], inserts: [{ start: 10, end: 12, after_word: 0 }] }
  assert.deepEqual(wordStartsInShort(plan, words).map((w) => w.s), [0, 3, 4])
})
