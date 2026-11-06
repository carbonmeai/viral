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
  const { script: checked, problems } = checkScript(script, limits, transcript, [])
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
  const { problems } = checkScript(script, limits, transcript, [{ start: 290, end: 320 }])
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
  const { problems } = checkScript(script, SCRIPT_LIMITS["question-recap"]!, transcript, [])
  assert.ok(problems.some((p) => p.includes("only after the last narrated line")))
})
