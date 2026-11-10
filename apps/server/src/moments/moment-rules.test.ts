import type { RankingProposal, TranscriptWord } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { sentencesOf, snapToSentences } from "../transcribe/sentences.ts"
import { checkRanking, fromProposedRanking, type RankingVideo, shuffledOrder } from "./moment-rules.ts"

// words spoken one after another, 0.4 s each with 0.1 s between, from `at`
const say = (at: number, text: string): Array<TranscriptWord> =>
  text.split(" ").map((w, i) => ({ w, s: at + i * 0.5, e: at + i * 0.5 + 0.4 }))

const options = { maxBack: 3, maxForward: 4, limit: 100, blocked: [], minStart: 0.4 }

test("a sentence ends on . ? ! or a pause over 1.5 s, never a shorter pause", () => {
  const words = [...say(1, "she was near"), ...say(3, "death to becoming."), ...say(10, "Look at her")]
  assert.deepEqual(sentencesOf(words).map((s) => s.text), ["she was near death to becoming.", "Look at her"])
})

test("a cut stretches to keep a sentence whole when it's cheap", () => {
  const sentences = sentencesOf([...say(10, "the vet gave her fluids."), ...say(20, "she stood up.")])
  const snapped = snapToSentences(sentences, 11, 21, options)
  assert.equal(snapped.problem, null)
  assert.equal(snapped.start, 9.92)
  assert.equal(snapped.end, 21.55)
  assert.match(snapped.notes.join(" "), /keep whole/)
  assert.match(snapped.notes.join(" "), /finish/)
})

test("a cut moves inward past a long sentence it can't keep whole", () => {
  const sentences = sentencesOf([...say(10, "one two three four five six seven eight nine ten eleven twelve."), ...say(30, "end")])
  // starts 4.5 s into the sentence: too far back to keep, so the shot starts after it
  const snapped = snapToSentences(sentences, 14.5, 25, options)
  assert.equal(snapped.problem, null)
  assert.ok(snapped.start > 15.8)
})

test("a cut it can't fix is a problem, never a cut that ships", () => {
  const sentences = sentencesOf(say(10, "a very long sentence that goes on and on and on and on and on and on and on and on and on."))
  const snapped = snapToSentences(sentences, 11, 13, options)
  assert.match(snapped.problem ?? "", /mid-sentence/)
})

test("a cut never stretches into an excluded range", () => {
  const sentences = sentencesOf(say(10, "she ran across the field."))
  const snapped = snapToSentences(sentences, 8, 11, { ...options, blocked: [{ start: 11.5, end: 20 }] })
  assert.ok(snapped.end <= 11.5)
})

test("the play order is shuffled with #1 last, building …3, 2, 1 for long lists", () => {
  const ten = shuffledOrder([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 7)
  assert.deepEqual(ten.slice(-3), [3, 2, 1])
  assert.deepEqual([...ten].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.notDeepEqual(ten.slice(0, 7), [10, 9, 8, 7, 6, 5, 4])
  const five = shuffledOrder([1, 2, 3, 4, 5], 1)
  assert.deepEqual(five.slice(-2), [2, 1])
  assert.deepEqual(shuffledOrder([1, 2, 3, 4, 5], 1), five, "the same seed shuffles the same way")
})

// two videos with a sentence every 10 s, and V2 an end screen from 55 s
const sentenceEvery10 = (n: number) => Array.from({ length: n }, (_, i) => say(i * 10 + 1, "here is a whole sentence.")).flat()
const videos: Array<RankingVideo> = [
  { words: sentenceEvery10(6), seconds: 60, excluded: [], framing: "fill" },
  { words: sentenceEvery10(6), seconds: 60, excluded: [{ start: 55, end: 60 }], framing: null }
]
const shot = (role: "before" | "care" | "after", start: number, end: number) => ({ role, start, end, note: `${role} frames` })
const good: RankingProposal = {
  title: { lead: "Ranking Animal ", accent: "Comebacks" },
  entries: [
    { rank: 2, label: "Puppy walks again", emoji: "🐶", shots: [shot("before", 3.6, 6), shot("care", 13.6, 16), shot("after", 23.6, 26)] },
    {
      rank: 1,
      source: 1,
      label: "Horse who gave up",
      emoji: "🐴",
      shots: [shot("before", 3.6, 9), shot("care", 13.6, 19), shot("care", 23.6, 29), shot("after", 33.6, 39)]
    }
  ],
  order: [2, 1]
}

test("a good ranking passes, with its framing settled and each shot's words", () => {
  const checked = checkRanking(good, { videos, maxSeconds: 180 })
  assert.deepEqual(checked.problems, [])
  const [two, one] = checked.value.entries
  assert.equal(two!.shots[0]!.framing, "fill", "V1's detected framing")
  assert.equal(one!.shots[0]!.framing, "window", "no framing detected: the window")
  assert.equal(two!.shots[0]!.text, "")
  assert.ok(checked.value.durationS > 20)
})

test("a shot that cuts a sentence is snapped to the whole sentence", () => {
  const cut: RankingProposal = { ...good, entries: [{ ...good.entries[0]!, shots: [shot("before", 1.5, 3), shot("care", 13.6, 16), shot("after", 23.6, 26)] }, good.entries[1]!] }
  const checked = checkRanking(cut, { videos, maxSeconds: 180 })
  assert.deepEqual(checked.problems, [])
  const before = checked.value.entries[0]!.shots[0]!
  assert.equal(before.start, 0.92)
  assert.equal(before.text, "here is a whole sentence.")
})

test("ranks, videos, roles, #1, the order, labels and length are checked", () => {
  const bad: RankingProposal = {
    title: { lead: "Ranking The Most Incredible Animal ", accent: "" },
    entries: [
      { rank: 1, label: "A label that is far too long to fit", emoji: "🐶🐱", shots: [shot("after", 3.6, 6), shot("before", 13.6, 16)] },
      { rank: 3, label: "Horse", emoji: "🐴", shots: [shot("before", 0.1, 6), shot("care", 13.6, 26), shot("after", 50, 58)] }
    ],
    order: [1, 3]
  }
  const problems = checkRanking(bad, { videos: [videos[0]!, videos[0]!], maxSeconds: 20 }).problems.join("\n")
  assert.match(problems, /accent word/)
  assert.match(problems, /ranks must be 1–2/)
  assert.match(problems, /both come from V1/)
  assert.match(problems, /label is \d+ characters/)
  assert.match(problems, /exactly one emoji/)
  assert.match(problems, /#1 \(.*\) has 2 shots/)
  assert.match(problems, /no care shot/)
  assert.match(problems, /before → care → after/)
  assert.match(problems, /starts before 0.4s/)
  assert.match(problems, /#1 runs .* #3 runs/)
  assert.match(problems, /#1 plays last/)
  assert.match(problems, /keep it within 20.0s/)
})

test("a shot in an end screen is refused", () => {
  const ad: RankingProposal = {
    ...good,
    entries: [good.entries[0]!, { ...good.entries[1]!, shots: [...good.entries[1]!.shots.slice(0, 3), shot("after", 51, 57)] }]
  }
  assert.match(checkRanking(ad, { videos, maxSeconds: 180 }).problems.join("\n"), /excluded range of V2/)
})

test("the agent's video numbers become positions, and a missing order is shuffled with #1 last", () => {
  const proposal = fromProposedRanking({
    title: good.title,
    entries: [
      { rank: 2, video: 1, label: "Puppy", emoji: "🐶", shots: [{ ...shot("before", 1, 2), framesChecked: true }] },
      { rank: 1, video: 2, label: "Horse", emoji: "🐴", shots: [] },
      { rank: 3, video: 3, label: "Cat", emoji: "🐱", shots: [] }
    ]
  })
  assert.equal(proposal.entries[0]!.source, undefined)
  assert.equal(proposal.entries[1]!.source, 1)
  assert.equal("framesChecked" in proposal.entries[0]!.shots[0]!, false)
  assert.equal(proposal.order.at(-1), 1)
})

test("a cut a few hundredths into a sentence still keeps its first word", () => {
  // "I think my favorite part." starts at 171.26; the brief's 0.1 s rounding gives 171.3
  const sentences = sentencesOf([{ w: "walk.", s: 168.86, e: 169.1 }, ...say(171.26, "I think my favorite part.")])
  const snapped = snapToSentences(sentences, 171.3, 173.7, { ...options, limit: 300 })
  assert.equal(snapped.problem, null)
  assert.equal(snapped.start, 171.18)
  assert.equal(snapped.end, 173.7, "already after the last word")
})
