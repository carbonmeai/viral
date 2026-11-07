import type { MusicBed, Script } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { bedBlocks, defaultDropWord, songSpans, voiceAt } from "./music-values.ts"

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
