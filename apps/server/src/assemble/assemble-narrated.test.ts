import { NarratedPlan, type ShotPlan } from "@viral/contracts"
import { Schema } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { BUILT_IN_PRESETS } from "../presets/built-in-presets.ts"
import { assembleNarrated, type NarratedInput } from "./assemble-narrated.ts"

const [recap, fullBleed] = BUILT_IN_PRESETS.map((p) => p.config)
const words = ["This", "guy", "tasted", "it.", "Then", "his", "friend"].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }))
const shots: ShotPlan = {
  shots: [
    { word: 0, src: 1542, note: "tray", wordText: "This", frame: null },
    { word: 4, src: 2012, fit: true, cropX: 0.3, note: "friend", wordText: "Then", frame: null }
  ],
  markers: [{ _tag: "Label", word: 2, x: 0.5, y: 0.3, text: "STICKY" }, { _tag: "Circle", word: 3, x: 0.4, y: 0.5 }],
  highlights: ["spicy"],
  inserts: [{ start: 1144, end: 1146, quote: "pain", afterWord: 3, afterWordText: "it.", frame: null }],
  outro: [{ start: 2036, end: 2040, quote: "So nasty.", frame: null }],
  storyboard: null
}
const input = (preset: typeof recap): NarratedInput => ({
  slug: "02-candy",
  title: "Candy",
  source: "/s/source.mp4",
  sourceTranscript: "/s/transcript.json",
  voiceover: "/p/vo.wav",
  voiceoverTranscript: "/p/transcript.json",
  voiceoverWords: words,
  preset: preset!,
  script: { headline: ["ONE CANDY", "EVERY TASTE"], beats: [] },
  shots,
  excluded: [{ start: 0, end: 3 }],
  credit: "Video: NileBlue",
  music: {
    track: {
      id: "t" as never,
      title: "drop",
      path: "t.wav",
      origin: { _tag: "Upload", file: "x" },
      rights: "owned",
      referenceId: null,
      durationS: 30,
      bpm: 117.5,
      dropS: 16.588,
      loudnessLufs: null,
      analyzedAt: null,
      createdAt: undefined as never
    },
    file: "/m/t.wav"
  },
  dropWord: 4
})

test("the full-bleed style: headline, chunk captions, quote boxes, labels, credit and the music drop", () => {
  const plan = assembleNarrated(input(fullBleed))
  // the renderer's contract, with nothing it doesn't model
  Schema.decodeSync(NarratedPlan)(plan, { onExcessProperty: "error" })
  assert.equal(plan.framing, "full")
  assert.deepEqual(plan.headline?.lines, [{ text: "ONE CANDY", color: "#FF2A2A" }, { text: "EVERY TASTE", color: "#FFFFFF" }])
  assert.equal(plan.caption_mode, "chunk")
  assert.equal(plan.quote_box, true)
  assert.equal(plan.credit, "Video: NileBlue")
  assert.deepEqual(plan.highlights, { spicy: "#FFD400" })
  assert.deepEqual(plan.shots[1], { src: 2012, word: 4, word_text: "Then", fit: true, crop_x: 0.3, note: "friend" })
  assert.deepEqual(plan.inserts, [{ start: 1144, end: 1146, after_word: 3, after_word_text: "it.", note: "pain" }])
  assert.equal(plan.annotations?.length, 2)
  assert.ok(typeof plan.music === "object" && plan.music.drop_word === 4 && plan.music.drop_word_text === "Then")
  assert.deepEqual(plan.exclude, [[0, 3]])
})

test("the recap style: no headline, labels or credit; no music without a known drop", () => {
  const plan = assembleNarrated({ ...input(recap), music: null })
  assert.equal(plan.headline, undefined)
  assert.equal(plan.credit, undefined)
  assert.deepEqual(plan.annotations?.map((a) => a.type), ["circle"], "labels are off in this style")
  assert.equal(plan.music, undefined)
  assert.equal(plan.caption_case, "lower")
})
