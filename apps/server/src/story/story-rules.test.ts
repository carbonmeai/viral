import type { StoryMap } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkStory } from "./story-rules.ts"

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })
const words = [w("It", 10), w("worked.", 10.3), w("Use", 100), w("code", 100.3)]
const scores = { openLoop: 8, completionCompulsion: 7, universalRelatability: 9, shareability: 6 }
const proposal = (approach: "question-recap" | "claim-interleaved" | "cut-down") =>
  ({ approach, title: "t", hook: "h", why: "w", scores })

test("snaps quotes and accepts three different approaches", () => {
  const map: StoryMap = {
    summary: "s",
    beats: [{ beat: "result", start: 5, end: 15, summary: "it worked", quotes: [{ text: "it worked", start: 9, end: 11 }] }],
    proposals: [proposal("claim-interleaved"), proposal("question-recap"), proposal("cut-down")]
  }
  const { value, problems } = checkStory(map, words, [])
  assert.deepEqual(problems, [])
  assert.deepEqual(value.beats[0]!.quotes[0], { text: "It worked.", start: 9.95, end: 10.75 })
})

test("reports invented or ad quotes, repeated approaches and bad scores", () => {
  const map: StoryMap = {
    summary: "s",
    beats: [{
      beat: "goal",
      start: 1,
      end: 200,
      summary: "x",
      quotes: [{ text: "it exploded", start: 10, end: 11 }, { text: "use code", start: 100, end: 101 }]
    }],
    proposals: [proposal("cut-down"), { ...proposal("cut-down"), scores: { ...scores, openLoop: 12 } }]
  }
  const text = checkStory(map, words, [{ start: 95, end: 110 }]).problems.join("\n")
  assert.match(text, /"it exploded" isn't in the transcript/)
  assert.match(text, /"use code" is inside an ad/)
  assert.match(text, /there are 2 proposals; give exactly 3/)
  assert.match(text, /different approach/)
  assert.match(text, /openLoop is 12/)
})
