import type { TranscriptWord } from "@viral/contracts"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { Script } from "@viral/contracts"
import { clipCues, cuesFromSrt, narratedCues, narratedShortCues, narratedWords, parseSrt, spreadWords, wordsAt } from "./caption-cues.ts"
import { layoutTimeline } from "./editor-values.ts"

// the candy fixtures from `bun run fixtures:sync`; the golden test skips without them
const CANDY_DIR = join(homedir(), ".viral/fixtures/candy")
const hasCandyFixture = existsSync(join(CANDY_DIR, "golden/01-every-taste-candy.srt"))
const readCandyJson = (file: string): unknown => JSON.parse(readFileSync(join(CANDY_DIR, file), "utf8"))

const transcriptWords = (file: string): ReadonlyArray<TranscriptWord> =>
  (readCandyJson(file) as { segments: ReadonlyArray<{ words?: ReadonlyArray<TranscriptWord> }> }).segments.flatMap((s) => s.words ?? [])

// a wav's length in seconds, from its header
const wavSeconds = (path: string) => {
  const b = readFileSync(path)
  let byteRate = 0
  for (let at = 12; at + 8 <= b.length;) {
    const id = b.toString("ascii", at, at + 4)
    const size = b.readUInt32LE(at + 4)
    if (id === "fmt ") byteRate = b.readUInt32LE(at + 16)
    if (id === "data") return size / byteRate
    at += 8 + size + (size % 2)
  }
  throw new Error("no data chunk")
}

test("reads a render's .srt, a cue's lines joined", () => {
  const srt = "1\n00:00:00,000 --> 00:00:00,120\nWhat\n\n2\r\n00:00:01,500 --> 00:00:02,250\nso sour\nreally\n\n"
  assert.deepEqual(parseSrt(srt), [
    { start: 0, end: 0.12, text: "What" },
    { start: 1.5, end: 2.25, text: "so sour really" }
  ])
})

test("groups words the way the narrated renderer shows them: chunks end at punctuation and pauses", () => {
  const w = (text: string, s: number, e: number) => ({ w: text, s, e })
  const words = [w("One", 0, 0.2), w("candy", 0.2, 0.5), w("hits", 0.5, 0.7), w("every", 0.7, 0.9), w("taste.", 0.9, 1.2), w("Then", 2, 2.2)]
  assert.deepEqual(narratedCues(words, { mode: "chunk", maxWords: 3, case: "upper" }, 3).map((c) => [c.text, c.start, c.end]), [
    ["ONE CANDY HITS", 0, 0.7],
    ["EVERY TASTE.", 0.7, 1.7],
    ["THEN", 2, 2.7]
  ])
  assert.deepEqual(narratedCues(words.slice(0, 2), { mode: "word", maxWords: 3, case: "lower" }, 1).map((c) => c.text), ["one", "candy"])
})

test("groups clip words the way the cut-down and ranking renderers do: 3 words or 16 characters", () => {
  const w = (text: string, s: number) => ({ w: text, s, e: s + 0.3 })
  const cues = clipCues([w("Extraordinarily", 0), w("big", 0.4), w("cat", 0.8), w("is", 1.2), w("here,", 1.6), w("ok", 2)], { case: "as-spoken" })
  assert.deepEqual(cues.map((c) => c.text), ["Extraordinarily big", "cat is here,", "ok"])
  assert.deepEqual(wordsAt([{ w: "a", s: 10, e: 10.5 }, { w: "b", s: 11, e: 12.5 }], 9.9, 11, 4), [{ w: "a", s: 4.1, e: 4.6 }])
  assert.deepEqual(spreadWords("so sour", 3, 1), [{ w: "so", s: 3, e: 3.5 }, { w: "sour", s: 3.5, e: 4 }])
})

test("the candy short's captions, worked out before the render, match its golden .srt", { skip: !hasCandyFixture }, () => {
  const srt = readFileSync(join(CANDY_DIR, "golden/01-every-taste-candy.srt"), "utf8")
  const plan = readCandyJson("narrated.json") as { outro: ReadonlyArray<{ start: number; end: number }> }
  const voiceover = transcriptWords("vo_tx/transcript.json")
  const source = transcriptWords("transcript.json")
  // no inserts: the voiceover plays as recorded, then the outro clips, each with its own words
  let t = wavSeconds(join(CANDY_DIR, "vo.wav"))
  const reals = plan.outro.map((clip) => {
    const words = wordsAt(source, clip.start, clip.end, t)
    t += clip.end - clip.start
    return words
  })
  const derived = narratedWords(voiceover, (s) => s, reals)
  const golden = parseSrt(srt)
  assert.equal(derived.length, golden.length)
  derived.forEach((w, i) => {
    assert.equal(w.w, golden[i]!.text, `word ${i}`)
    assert.ok(Math.abs(w.s - golden[i]!.start) < 0.002 && Math.abs(w.e - golden[i]!.end) < 0.002, `word ${i} "${w.w}" at ${w.s}–${w.e}`)
  })
  // the srt is one word a line; the cues group it as the style shows it, the same as worked out beforehand
  for (const style of [{ mode: "word", maxWords: 1, case: "lower" }, { mode: "chunk", maxWords: 3, case: "upper" }] as const) {
    const fromSrt = cuesFromSrt(srt, style, t)
    const before = narratedCues(derived, style, t)
    assert.equal(fromSrt.length, before.length)
    fromSrt.forEach((cue, i) => {
      assert.equal(cue.text, before[i]!.text)
      assert.ok(Math.abs(cue.start - before[i]!.start) < 0.002 && Math.abs(cue.end - before[i]!.end) < 0.002)
    })
  }
  assert.equal(cuesFromSrt(srt, { mode: "chunk", maxWords: 3, case: "upper" }, t)[0]!.text, "WHAT WOULD HAPPEN")
})

test("a narrated short's captions before the render: the voiceover's words past the real lines, each quote over its clip", () => {
  // "This guy tasted it. It hurt." at half a second a word, "Ow." (1s) after "it.", "Nasty." (2s) at the end
  const words = ["This", "guy", "tasted", "it.", "It", "hurt."].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }))
  const script: Script = {
    headline: null,
    beats: [
      { _tag: "Narration", text: "This guy tasted it." },
      { _tag: "Real", quote: "Ow.", start: 40, end: 41 },
      { _tag: "Narration", text: "It hurt." },
      { _tag: "Real", quote: "So nasty.", start: 60, end: 62 }
    ]
  }
  const layout = layoutTimeline(script, words, 3)
  const cues = narratedShortCues(layout, words, { mode: "chunk", maxWords: 3, case: "upper" })
  assert.deepEqual(cues.map((c) => [c.text, Number(c.start.toFixed(2))]), [
    ["THIS GUY TASTED", 0],
    ["IT.", 1.5],
    ["OW.", 1.9],
    ["IT HURT.", 3],
    ["SO NASTY.", 4]
  ])
  assert.equal(cues.at(-1)!.end, layout.total)
})
