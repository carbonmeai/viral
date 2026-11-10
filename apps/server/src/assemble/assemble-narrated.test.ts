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
  highlights: ["spicy", { word: "cold", color: "cyan" }, { word: "candy", color: "accent" }],
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
      beatSource: "manual",
      kind: "song",
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
  assert.deepEqual(plan.highlights, { spicy: "#FFD400", cold: "#5CE1FF", candy: "#FFD400" }, "a colour by meaning, or the style's accent")
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

test("a short from two videos lists V2 in `sources`, its ads by index, and each clip's video; V1 clips stay as before", () => {
  const two: ShotPlan = {
    ...shots,
    shots: [shots.shots[0]!, { ...shots.shots[1]!, source: 1 }],
    inserts: [{ ...shots.inserts[0]!, source: 1 }]
  }
  const plan = assembleNarrated({
    ...input(fullBleed),
    shots: two,
    others: [{ source: "/s2/source.mp4", sourceTranscript: "/s2/transcript.json", excluded: [{ start: 10, end: 20 }] }],
    credit: "Video: NileBlue · Mark Rober"
  })
  Schema.decodeSync(NarratedPlan)(plan, { onExcessProperty: "error" })
  assert.deepEqual(plan.sources, [{ path: "/s2/source.mp4", transcript: "/s2/transcript.json" }])
  assert.deepEqual(plan.exclude, [[0, 3]], "V1's ranges stay in `exclude`")
  assert.deepEqual(plan.exclude_by_source, { "1": [[10, 20]] })
  assert.deepEqual(plan.shots[0], { src: 1542, word: 0, word_text: "This", note: "tray" }, "a V1 shot has no source")
  assert.equal(plan.shots[1]?.source, 1)
  assert.equal(plan.inserts?.[0]?.source, 1)
  assert.equal(plan.outro?.[0]?.source, undefined)
  assert.equal(plan.credit, "Video: NileBlue · Mark Rober")
})

test("a single-video plan has no sources or per-video ranges", () => {
  const plan = assembleNarrated({ ...input(fullBleed), others: [] })
  assert.equal("sources" in plan, false)
  assert.equal("exclude_by_source" in plan, false)
})

test("a style without the opt-ins writes none of their keys; Story recap adds soft joins, a breath and the voice level", () => {
  const plain = assembleNarrated(input(recap))
  for (const key of ["soft_joins", "insert_pad", "voice_gain"]) assert.equal(key in plain, false, `${key} absent`)
  const storyRecap = BUILT_IN_PRESETS.find((p) => p.name === "Story recap")!.config
  const plan = assembleNarrated(input(storyRecap))
  Schema.decodeSync(NarratedPlan)(plan, { onExcessProperty: "error" })
  assert.equal(plan.soft_joins, true)
  assert.equal(plan.insert_pad, 0.25)
  assert.equal(plan.voice_gain, 1.7)
  assert.equal(plan.main_height, 1280)
  assert.equal(plan.caption_y, 0.78)
})

test("an insert whose next line is skipped resumes on the word after it", () => {
  const skipping: ShotPlan = { ...shots, inserts: [{ ...shots.inserts[0]!, resumeWord: 6, resumeWordText: "friend" }] }
  const plan = assembleNarrated({ ...input(recap), shots: skipping })
  Schema.decodeSync(NarratedPlan)(plan, { onExcessProperty: "error" })
  assert.deepEqual(plan.inserts, [{ start: 1144, end: 1146, after_word: 3, after_word_text: "it.", resume_word: 6, resume_word_text: "friend", note: "pain" }])
})

test("the closing line is cut out of the narration and plays under the end card when the style asks for it", () => {
  const closing = { narrationEnd: 2.88, voEnd: 3.7, question: "Would you eat it?" }
  const plan = assembleNarrated({ ...input(recap), closing })
  Schema.decodeSync(NarratedPlan)(plan, { onExcessProperty: "error" })
  assert.equal(plan.narration_end, 2.88)
  assert.deepEqual(plan.cta, { question: "Would you eat it?", vo_start: 2.88, vo_end: 3.7 })
  // the style has it off: the line is only cut out, so it's never heard over the last shot
  const off = assembleNarrated({ ...input(recap), closing: { ...closing, question: null } })
  assert.equal(off.narration_end, 2.88)
  assert.equal("cta" in off, false)
  // no closing line: neither key, the plan exactly as before
  const none = assembleNarrated(input(recap))
  assert.equal("narration_end" in none, false)
  assert.equal("cta" in none, false)
})
