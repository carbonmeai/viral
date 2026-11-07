import type { ProposedSetStory } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkSetStory } from "./set-story-rules.ts"

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })
// the same words in both videos, at different times: a quote snaps in its own video
const v1 = { words: [w("It", 10), w("worked.", 10.3), w("Use", 100), w("code", 100.3)], seconds: 600, excluded: [{ start: 95, end: 110 }] }
const v2 = { words: [w("It", 40), w("worked.", 40.3), w("Never", 300), w("again.", 300.3)], seconds: 400, excluded: [{ start: 290, end: 310 }] }
const scores = { openLoop: 8, completionCompulsion: 7, universalRelatability: 9, shareability: 6 }
const proposal = (approach: "question-recap" | "claim-interleaved" | "cut-down", videos: ReadonlyArray<number>) =>
  ({ approach, title: approach, hook: "h", why: "w", scores, videos })

test("snaps each quote in its own video and stores set positions", () => {
  const story: ProposedSetStory = {
    summary: "s",
    videos: [{ video: 1, summary: "the first try" }, { video: 2, summary: "the second" }],
    beats: [
      { video: 1, beat: "result", start: 5, end: 15, summary: "first", quotes: [{ text: "it worked", start: 9, end: 11 }] },
      { video: 2, beat: "result", start: 35, end: 45, summary: "second", quotes: [{ text: "it worked", start: 41, end: 42 }] }
    ],
    proposals: [proposal("cut-down", [2, 1, 2]), proposal("question-recap", [1, 2]), proposal("claim-interleaved", [1, 2])]
  }
  const { value, problems } = checkSetStory(story, [v1, v2])
  assert.deepEqual(problems, [])
  assert.deepEqual(value.beats.map((b) => [b.source, b.quotes[0]]), [
    [0, { text: "It worked.", start: 9.95, end: 10.75 }],
    [1, { text: "It worked.", start: 39.95, end: 40.75 }]
  ])
  assert.deepEqual(value.proposals[0]!.sources, [0, 1], "in set order, each once")
  assert.deepEqual(value.videos.map((v) => v.source), [0, 1])
  assert.ok(!("videos" in value.proposals[0]!))
})

test("a quote in the wrong video, an unknown video, a video's own ads and one-video proposals are problems", () => {
  const story: ProposedSetStory = {
    summary: "s",
    videos: [{ video: 4, summary: "?" }],
    beats: [
      // "never again" is in V2, not V1
      { video: 1, beat: "reaction", start: 290, end: 310, summary: "x", quotes: [{ text: "never again", start: 300, end: 301 }] },
      { video: 3, beat: "goal", start: 1, end: 2, summary: "x", quotes: [] },
      // V2's ad is at 290–310; V1's ad at 95–110 says nothing about V2
      { video: 2, beat: "reaction", start: 290, end: 310, summary: "x", quotes: [{ text: "never again", start: 300, end: 301 }] },
      { video: 2, beat: "goal", start: 500, end: 510, summary: "past the end", quotes: [] }
    ],
    proposals: [proposal("cut-down", [1]), proposal("question-recap", [1, 5]), proposal("claim-interleaved", [1, 2])]
  }
  const text = checkSetStory(story, [v1, v2]).problems.join("\n")
  assert.match(text, /beat 1 \(reaction\): "never again" isn't in V1's transcript near 300.0s/)
  assert.match(text, /beat 2 \(goal\): there's no V3; the set's videos are V1–V2/)
  assert.match(text, /beat 3 \(reaction\): "never again" is inside an ad or sponsor read in V2/)
  assert.match(text, /beat 4 \(goal\) starts at 500.0s, after V2 ends \(400s\)/)
  assert.match(text, /there's no V4 to summarise/)
  assert.match(text, /proposal 1 \(cut-down\) uses one video; a short from this set uses at least 2/)
  assert.match(text, /proposal 2 \(question-recap\): there's no V5/)
  assert.doesNotMatch(text, /proposal 3/)
})

test("three proposals with different approaches", () => {
  const story: ProposedSetStory = {
    summary: "s",
    videos: [],
    beats: [{ video: 1, beat: "goal", start: 1, end: 2, summary: "x", quotes: [] }],
    proposals: [proposal("cut-down", [1, 2]), proposal("cut-down", [1, 2])]
  }
  const text = checkSetStory(story, [v1, v2]).problems.join("\n")
  assert.match(text, /there are 2 proposals; give exactly 3/)
  assert.match(text, /different approach/)
})
