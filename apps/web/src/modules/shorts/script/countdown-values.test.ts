import type { Script } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { countdownOf, entryHeading, rankCardColor } from "./countdown-values.ts"

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ")
const script: Script = {
  headline: null,
  beats: [
    { _tag: "Narration", text: "These two dogs had no chance." },
    { _tag: "Narration", text: "Number one had given up." },
    { _tag: "Narration", text: `Number two, ${words(30)}` },
    { _tag: "Real", quote: "Good boy.", start: 10, end: 13 },
    { _tag: "Narration", text: `Number one, ${words(30)}` },
    { _tag: "Real", quote: "Best dog.", start: 20, end: 24, source: 1 },
    { _tag: "Narration", text: "One month later." },
    { _tag: "Real", quote: "He runs now.", start: 40, end: 58, source: 1 },
    { _tag: "Cta", question: "Which one got you?" }
  ]
}

test("the countdown: the hook (teasing #1) and each entry with its video, its length and #1's reveal", () => {
  const countdown = countdownOf(script, 2)!
  assert.equal(countdown.hookEnd, 2, "\"Number one had given up\" stays in the hook")
  assert.deepEqual(countdown.entries.map((e) => [e.rank, e.start, e.end, e.source]), [[2, 2, 4], [1, 4, 8]].map(([r, s, e], i) => [r, s, e, i]))
  assert.equal(Math.round(countdown.entries[0]!.seconds), 13, "32 words at 3.2/s + 3 s")
  assert.equal(countdown.entries[1]!.revealSeconds, 18)
  assert.equal(entryHeading(countdown.entries[1]!, (v) => ["Rex", "Max"][v]!), "#1 · Max · about 15 s + the 18 s reveal")
  assert.equal(countdownOf({ headline: null, beats: [{ _tag: "Narration", text: "No countdown." }] }, 2), null)
  assert.equal(rankCardColor(1), "#FFD400")
  assert.equal(rankCardColor(3), "#E8202A")
})
