import type { Script } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkScript, SCRIPT_LIMITS } from "./script-rules.ts"

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })
const transcript = [w("It's", 100), w("like", 100.3), w("glue.", 100.6), w("Use", 300), w("code", 300.3), w("candy.", 300.6)]
const narration = (n: number) => ({ _tag: "Narration" as const, text: Array.from({ length: n }, () => "word").join(" ") })
const limits = SCRIPT_LIMITS["claim-interleaved"]!

test("snaps real lines to the transcript and passes a well-formed script", () => {
  const script: Script = {
    headline: ["THIS CANDY HITS", "EVERY TASTE AT ONCE"],
    beats: [narration(70), ...Array.from({ length: 4 }, () => ({ _tag: "Real" as const, quote: "it's like glue", start: 98, end: 99 }))]
  }
  const { script: checked, problems } = checkScript(script, limits, [{ words: transcript, excluded: [] }])
  assert.deepEqual(problems, [])
  assert.deepEqual(checked.beats[1], { _tag: "Real", quote: "It's like glue.", start: 99.95, end: 101.05 })
})

test("reports invented quotes, ad overlaps, word counts and missing reactions", () => {
  const script: Script = {
    headline: ["ONE TWO THREE FOUR FIVE", "SIX SEVEN EIGHT NINE"],
    beats: [
      { _tag: "Real", quote: "use code candy", start: 300, end: 301 },
      narration(130),
      { _tag: "Real", quote: "it was amazing", start: 100, end: 101 }
    ]
  }
  const { problems } = checkScript(script, limits, [{ words: transcript, excluded: [{ start: 290, end: 320 }] }])
  const text = problems.join("\n")
  assert.match(text, /isn't in the transcript/)
  assert.match(text, /inside an ad or sponsor read/)
  assert.match(text, /must open with a narrated line/)
  assert.match(text, /narration is 130 words; this approach needs 60–100/)
  assert.match(text, /there are 2 real lines; this approach needs 4–9/)
  assert.match(text, /headline is longer than 8 words/)
})

test("question-recap keeps real lines for the ending", () => {
  const script: Script = {
    headline: null,
    beats: [narration(50), { _tag: "Real", quote: "it's like glue", start: 100, end: 101 }, narration(50)]
  }
  const { problems } = checkScript(script, SCRIPT_LIMITS["question-recap"]!, [{ words: transcript, excluded: [] }])
  assert.ok(problems.some((p) => p.includes("only after the last narrated line")))
})

test("checks each real line against its own video, and keeps V1's lines as they were", () => {
  const other = [{ w: "So", s: 50, e: 50.5 }, { w: "nasty.", s: 50.5, e: 51.2 }]
  const sources = [{ words: transcript, excluded: [] }, { words: other, excluded: [{ start: 40, end: 60 }] }]
  const real = (quote: string, start: number, source?: number) =>
    ({ _tag: "Real" as const, quote, start, end: start + 1, ...(source === undefined ? {} : { source }) })
  const script: Script = {
    headline: null,
    beats: [narration(70), real("it's like glue", 99), real("it's like glue", 99, 0), real("so nasty", 50, 1), real("so nasty", 50, 2), real("so nasty", 50)]
  }
  const { script: checked, problems } = checkScript(script, limits, sources)
  assert.deepEqual(checked.beats[1], { _tag: "Real", quote: "It's like glue.", start: 99.95, end: 101.05 }, "V1 is left out")
  assert.deepEqual(checked.beats[2], checked.beats[1], "an explicit V1 is stored like an absent one")
  assert.equal((checked.beats[3] as { source?: number }).source, 1)
  assert.deepEqual(problems, [
    "beat 4: \"so nasty\" is inside an ad or sponsor read (40–60s)",
    "beat 5: V3 isn't one of this short's videos (V1–V2)",
    "beat 6: \"so nasty\" isn't in V1's transcript near 50.0s; quote the words exactly as spoken"
  ])
})
