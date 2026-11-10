import type { MusicBed, MusicBlock, Script } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  addBlock,
  arrangementProblems,
  barAt,
  bedBlocks,
  blockLabel,
  defaultDropWord,
  duplicateBlock,
  loopTicks,
  moveBlock,
  moveRange,
  placeBlocks,
  plainProblems,
  songRangeOf,
  songSpans,
  splitBlock,
  voiceAt
} from "./music-values.ts"

const words = ["This", "guy", "tasted", "it.", "It", "hurt."].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }))
const script: Script = {
  headline: null,
  beats: [
    { _tag: "Narration", text: "This guy tasted it." },
    { _tag: "Real", quote: "Ow.", start: 40, end: 41 },
    { _tag: "Narration", text: "It hurt." }
  ]
}

test("the drop lands on the first word of the last narrated line unless you pick one", () => {
  assert.equal(defaultDropWord(script, words), 4)
  assert.equal(defaultDropWord({ headline: null, beats: [{ _tag: "Narration", text: "This guy tasted it." }] }, words), 0)
})

const bed = {
  durationS: 30,
  segments: [
    { kind: "groove", from: 8, to: 12, at: 0 },
    { kind: "groove", from: 8, to: 12, at: 4 },
    { kind: "build", from: 12, to: 20, at: 8 },
    { kind: "drop", from: 20, to: 33.8, at: 16 },
    { kind: "drop-loop", from: 20, to: 20.2, at: 29.8 }
  ]
} as unknown as MusicBed

test("the bed's parts on the timeline, and the parts of the song that play", () => {
  assert.deepEqual(bedBlocks(bed).map((b) => [b.label, b.start, b.end]), [
    ["Groove", 0, 8],
    ["Build-up", 8, 16],
    ["Drop", 16, 30]
  ])
  assert.deepEqual(songSpans(bed), [{ from: 8, to: 33.8 }])
})

test("the voiceover pauses while a real line plays, then goes on", () => {
  const pauses = [{ at: 2, dur: 1 }]
  assert.deepEqual(voiceAt(pauses, 1.5), { t: 1.5, paused: false })
  assert.deepEqual(voiceAt(pauses, 2.5), { t: 2, paused: true })
  assert.deepEqual(voiceAt(pauses, 3.5), { t: 2.5, paused: false })
})

// 2 s bars, the drop at bar 4; words a second apart (word i starts at i s in the short); a 20 s short
const grid = { barS: 2, origin: 1, dropBar: 4, songBars: 14 }
const wordList = Array.from({ length: 20 }, (_, i) => ({ w: `w${i}`, s: i, e: i + 0.5 }))
const place = { barS: 2, dropWord: 6, wordAt: (i: number) => wordList[i]?.s ?? null, total: 20 }
const check = { ...place, songBars: 14, words: wordList }
const block = (fromBar: number, toBar: number, loops: number, start: MusicBlock["start"] = "after"): MusicBlock => ({ fromBar, toBar, loops, start })

test("a part's bars in the song, named the way the lane labels them", () => {
  assert.deepEqual(songRangeOf(block(2, 4, 1), grid), { from: 5, to: 9 })
  assert.equal(barAt(9.6, grid), 4)
  assert.equal(barAt(99, grid), 14)
  assert.equal(blockLabel(block(8, 12, 3), 4), "Bars 9–12 ×3")
  assert.equal(blockLabel(block(4, 8, 1), 4), "Drop")
  assert.equal(blockLabel(block(2, 4, 2), 4), "Build-up ×2")
})

test("parts before the first pin end on it, the first filling the start; the last loops to the end", () => {
  const placed = placeBlocks([block(0, 1, 2), block(2, 4, 1), block(4, 8, 1, "drop"), block(10, 12, 1)], place)
  assert.deepEqual(placed, [
    { atS: 0, endS: 2, phase: 2 },
    { atS: 2, endS: 6, phase: 6 },
    { atS: 6, endS: 14, phase: 6 },
    { atS: 14, endS: 20, phase: 14 }
  ])
  // the first part loops back from its end; the last repeats every 4 s from where it starts
  assert.deepEqual(loopTicks(placed[0]!, block(0, 1, 2), 2), [])
  assert.deepEqual(loopTicks(placed[3]!, block(10, 12, 1), 2), [18])
})

test("between pins the last part loops on and is cut at the next pin", () => {
  const placed = placeBlocks([block(4, 6, 1, "drop"), block(6, 7, 1), block(8, 9, 1, { word: 15 })], place)
  assert.deepEqual(placed.map((p) => p && [p.atS, p.endS]), [[6, 10], [10, 15], [15, 20]])
})

test("problems are said before the server sees the arrangement", () => {
  assert.deepEqual(arrangementProblems([block(0, 2, 1), block(4, 8, 1, "drop"), block(10, 12, 2, { word: 12 })], check), [])
  assert.deepEqual(arrangementProblems([], check), ["There are no parts. Add one, or reset to automatic."])
  assert.deepEqual(arrangementProblems([block(12, 16, 1)], check), ["Part 1 runs past the song: it has 14 bars."])
  assert.deepEqual(arrangementProblems([block(4, 8, 1, { word: 9 }), block(8, 9, 1, { word: 3 })], check), [
    "Part 2 starts on “w3”, which comes before part 1’s word. Pinned parts follow the narration in order."
  ])
  // three bars already fill the 6 s before the drop, so the first part is never heard
  assert.deepEqual(arrangementProblems([block(0, 1, 1), block(1, 4, 1), block(4, 5, 1, "drop")], check), [
    "Part 1 isn’t heard: the parts after it already fill the start before part 3."
  ])
  assert.deepEqual(arrangementProblems([block(4, 8, 3, "drop"), block(0, 1, 1)], check), ["Part 2 would start after the short ends. Remove it or pin it earlier."])
  assert.deepEqual(arrangementProblems([block(4, 8, 1, "drop")], { ...check, dropWord: null }), [
    "Part 1 starts on the drop word, but there isn’t one yet."
  ])
})

test("the server's problems in the editor's words", () => {
  assert.deepEqual(plainProblems(["block 2 won't be heard: block 3 is pinned to start at 6.00s, before it would begin"]), [
    "Part 2 won't be heard: part 3 is pinned to start at 6.00s, before it would begin."
  ])
})

test("split, duplicate, move, add and drag to other bars", () => {
  const blocks = [block(0, 4, 3), block(4, 8, 1, "drop")]
  assert.deepEqual(splitBlock(blocks, 0, 2), [block(0, 2, 3), block(2, 4, 1), block(4, 8, 1, "drop")])
  assert.deepEqual(splitBlock(blocks, 0, 4), blocks)
  assert.deepEqual(duplicateBlock(blocks, 1), [block(0, 4, 3), block(4, 8, 1, "drop"), block(4, 8, 1)])
  assert.deepEqual(moveBlock(blocks, 1, -1), [block(4, 8, 1, "drop"), block(0, 4, 3)])
  assert.deepEqual(moveBlock(blocks, 1, 1), blocks)
  assert.deepEqual(addBlock(blocks, 14), [...blocks, block(8, 12, 1)])
  assert.deepEqual(addBlock(blocks, 10).at(-1), block(6, 10, 1))
  assert.deepEqual(moveRange(block(0, 4, 2), 12, 14), block(10, 14, 2))
})

test("after a real line the voiceover can jump over a skipped line", () => {
  const pauses = [{ at: 2, dur: 1, skip: 0.5 }]
  assert.deepEqual(voiceAt(pauses, 2.5), { t: 2, paused: true })
  assert.deepEqual(voiceAt(pauses, 3.2), { t: 2.7, paused: false })
})
