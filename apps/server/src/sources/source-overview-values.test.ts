import type { Project, Proposal } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { matchProposals, transcriptLines } from "./source-overview-values.ts"

const scores = { openLoop: 8, completionCompulsion: 7, universalRelatability: 8, shareability: 7 }
const proposals: Array<Proposal> = [
  { approach: "claim-interleaved", title: "Every taste", hook: "h", why: "w", scores },
  { approach: "question-recap", title: "What if", hook: "h", why: "w", scores },
  { approach: "cut-down", title: "Cut", hook: "h", why: "w", scores }
]
const project = (approach: Project["approach"], title: string) => ({ approach, title }) as Project

test("each short is matched to the proposal it came from", () => {
  const matched = matchProposals([
    project("question-recap", "What if"),
    project("claim-interleaved", "Renamed by you"),
    project("claim-interleaved", "Every taste")
  ], proposals)
  assert.deepEqual(matched.map((m) => m.proposal), [1, 0, 0], "by title, or by approach when it's the only one")
  assert.deepEqual(matchProposals([project("question-recap", "x")], []).map((m) => m.proposal), [null], "no story, no match")
})

test("the transcript reads as lines with a word count", () => {
  const w = (word: string) => ({ w: word, s: 0, e: 1 })
  const result = transcriptLines({
    source: "x",
    language: "en",
    segments: [{ start: 0, end: 2, text: " Hello there. ", words: [w("Hello"), w("there.")] }, { start: 2, end: 3, text: "Bye.", words: [w("Bye.")] }]
  })
  assert.equal(result.words, 3)
  assert.deepEqual(result.lines, [{ start: 0, end: 2, text: "Hello there." }, { start: 2, end: 3, text: "Bye." }])
})
