import type { Script, ShotProposal } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkShots, narrationEnds, placeReals } from "./shot-rules.ts"

// "This guy tasted the spicy cold mix. It hurt. So he tried again." at one word per second
const heard = ["This", "guy", "tasted", "the", "spicy", "cold", "mix.", "It", "hurt.", "So", "he", "tried", "again."]
const words = heard.map((w, i) => ({ w, s: i, e: i + 0.8 }))
const script: Script = {
  headline: null,
  beats: [
    { _tag: "Narration", text: "This guy tasted the spicy-cold mix." },
    { _tag: "Real", quote: "Right now, it's just pain.", start: 1144, end: 1146 },
    { _tag: "Narration", text: "It hurt." },
    { _tag: "Narration", text: "So he tried again." },
    { _tag: "Real", quote: "This is so nasty.", start: 2036, end: 2040 }
  ]
}

test("narration beats end on the voiceover word that matches their last word", () => {
  assert.deepEqual(narrationEnds(script, words), [6, 8, 12])
})

test("real lines become inserts after their narration, or outro clips at the end", () => {
  const { inserts, outro } = placeReals(script, words)
  assert.deepEqual(inserts, [{ quote: "Right now, it's just pain.", start: 1144, end: 1146, afterWord: 6, afterWordText: "mix." }])
  assert.deepEqual(outro, [{ quote: "This is so nasty.", start: 2036, end: 2040 }])
})

const ctx = { words, voiceoverSeconds: 13, sources: [{ seconds: 2300, excluded: [{ start: 0, end: 3 }] }], ...placeReals(script, words) }

test("a good shot list passes and gets its anchors' words", () => {
  const proposal: ShotProposal = {
    shots: [0, 2, 4, 7, 9, 11].map((word, i) => ({ word, src: 100 + i * 10, note: "n" })),
    markers: [{ _tag: "Label", word: 4, x: 0.5, y: 0.3, text: "spicy" }]
  }
  const { value, problems } = checkShots(proposal, ctx)
  assert.deepEqual(problems, [])
  assert.equal(value.shots[3]!.wordText, "It")
})

test("reports bad anchors, long shots, excluded footage and a missing resume shot", () => {
  const proposal: ShotProposal = {
    shots: [{ word: 1, src: 1, note: "ad" }, { word: 5, src: 2301, note: "end" }, { word: 3, src: 50, speed: 9, note: "x" }],
    markers: [{ _tag: "Label", word: 40, x: 2, y: 0.5, text: "far too many words here" }]
  }
  const text = checkShots(proposal, ctx).problems.join("\n")
  assert.match(text, /first shot must start on word 0/)
  assert.match(text, /inside an excluded range \(0\.0–3\.0s\)/)
  assert.match(text, /shot 2 \(word 5 "cold"\): the next shot must start on a later word/)
  assert.match(text, /outside the video/)
  assert.match(text, /speed 9 is outside/)
  assert.match(text, /lasts 10\.0s/)
  assert.match(text, /start a new shot on word 7 "It", where the narration resumes/)
  assert.match(text, /word 40 isn't in the voiceover/)
  assert.match(text, /x and y are fractions/)
  assert.match(text, /too long/)
})

test("highlights keep their colour and must be words of the voiceover", () => {
  const proposal: ShotProposal = {
    shots: [0, 2, 4, 7, 9, 11].map((word, i) => ({ word, src: 100 + i * 10, note: "n" })),
    markers: [],
    highlights: ["Spicy,", { word: "Cold", color: "cyan" }, { word: "glue", color: "green" }]
  }
  const { value, problems } = checkShots(proposal, ctx)
  assert.deepEqual(value.highlights, ["spicy", { word: "cold", color: "cyan" }, { word: "glue", color: "green" }])
  assert.deepEqual(problems, ['highlight "glue" isn\'t a word of the voiceover'])
})

test("each shot plays from its own video, and a real line keeps its video", () => {
  const two = { ...ctx, sources: [{ seconds: 2300, excluded: [] }, { seconds: 60, excluded: [{ start: 10, end: 20 }] }] }
  const proposal: ShotProposal = {
    shots: [0, 2, 4, 7, 9, 11].map((word, i) => ({ word, src: 30 + i, note: "n", ...(i === 1 ? { source: 1 } : i === 2 ? { source: 0 } : {}) })),
    markers: []
  }
  const { value, problems } = checkShots(proposal, two)
  assert.deepEqual(problems, [])
  assert.equal(value.shots[1]!.source, 1)
  assert.ok(!("source" in value.shots[2]!), "V1 is stored as before, without a source")

  const wrong = checkShots({ ...proposal, shots: proposal.shots.map((s, i) => i === 3 ? { ...s, src: 12, source: 1 } : i === 4 ? { ...s, source: 4 } : s) }, two)
  assert.match(wrong.problems.join("\n"), /shot 4 \(word 7 "It", V2\) plays 12\.0–14\.0s, inside an excluded range \(10\.0–20\.0s\)/)
  assert.match(wrong.problems.join("\n"), /shot 5 \(word 9 "So", V5\): V5 isn't one of this short's videos \(V1–V2\)/)

  const reals = placeReals({ headline: null, beats: [{ _tag: "Narration", text: "This guy." }, { _tag: "Real", quote: "x", start: 1, end: 2, source: 1 }] }, words)
  assert.deepEqual(reals.outro, [{ start: 1, end: 2, quote: "x", source: 1 }])
})

// "This guy tasted the spicy cold mix." → REAL "It hurts so much." → (skipped) "He said it hurt." "So he tried again."
const skipHeard = ["This", "guy", "tasted", "the", "spicy", "cold", "mix.", "He", "said", "it", "hurt.", "So", "he", "tried", "again."]
const skipWords = skipHeard.map((w, i) => ({ w, s: i, e: i + 0.8 }))
const skipping: Script = {
  headline: null,
  beats: [
    { _tag: "Narration", text: "This guy tasted the spicy-cold mix." },
    { _tag: "Real", quote: "It hurts so much.", start: 1144, end: 1146 },
    { _tag: "Narration", text: "He said it hurt.", skipped: true },
    { _tag: "Narration", text: "So he tried again." }
  ]
}

test("an insert before a skipped line resumes on the first word after it", () => {
  const { inserts } = placeReals(skipping, skipWords)
  assert.deepEqual(inserts, [{ quote: "It hurts so much.", start: 1144, end: 1146, afterWord: 6, afterWordText: "mix.", resumeWord: 11, resumeWordText: "So" }])
})

test("shots start where the narration resumes, never in the skipped words, and run only until the pause", () => {
  const skipCtx = { words: skipWords, voiceoverSeconds: 15, sources: [{ seconds: 2300, excluded: [] }], inserts: placeReals(skipping, skipWords).inserts }
  const shotsAt = (at: ReadonlyArray<number>): ShotProposal => ({ shots: at.map((word, i) => ({ word, src: 100 + i * 10, note: "n" })), markers: [] })
  // word 4 to 11 is 7 s of voiceover, but the shot only plays until the pause after "mix." (6.8 s → 2.8 s on screen)
  assert.deepEqual(checkShots(shotsAt([0, 2, 4, 11, 13]), skipCtx).problems, [])
  const text = checkShots(shotsAt([0, 2, 4, 8, 13]), skipCtx).problems.join("\n")
  assert.match(text, /shot on word 8 "said" is in narration the short skips after "It hurts so much."; start it on word 11 or later/)
  assert.match(text, /start a new shot on word 11 "So", where the narration resumes/)
})
