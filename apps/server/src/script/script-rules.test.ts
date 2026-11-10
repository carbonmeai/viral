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

// ---------------------------------------------------------------- whole sentences, skipped lines, story-recap

// words spoken one after another, 0.4 s each with 0.1 s between, from `at`
const say = (at: number, text: string) => text.split(" ").map((word, i) => ({ w: word, s: at + i * 0.5, e: at + i * 0.5 + 0.4 }))
const real = (quote: string, start: number) => ({ _tag: "Real" as const, quote, start, end: start + 1 })

test("a real line that cuts a sentence is widened to the whole sentence", () => {
  const words = say(10, "I am not scared of anything. Bring it on.")
  const script: Script = { headline: null, beats: [narration(70), ...Array.from({ length: 4 }, () => real("not scared of", 11))] }
  const { script: checked, problems } = checkScript(script, limits, [{ words, excluded: [] }])
  assert.deepEqual(problems, [])
  assert.deepEqual(checked.beats[1], { _tag: "Real", quote: "I am not scared of anything.", start: 9.95, end: 13.05 })
})

test("a sentence too long to play whole is a problem that says so", () => {
  const long = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ")
  const words = say(10, `${long} end.`)
  const script: Script = { headline: null, beats: [narration(70), ...Array.from({ length: 4 }, () => real("w3 w4", 11.5))] }
  const { problems } = checkScript(script, limits, [{ words, excluded: [] }])
  assert.match(problems.join("\n"), /beat 2: "w3 w4" cuts a sentence; as whole sentences it's "w0 w1 .*" \(10\.\ds\), over 8s/)
})

test("a skipped line is voiced but not counted, and only follows a real line with narration after it", () => {
  const words = say(10, "It's like getting electrocuted.")
  const said = { _tag: "Narration" as const, text: "He said it felt like getting electrocuted.", skipped: true }
  const good: Script = {
    headline: null,
    beats: [narration(60), real("like getting electrocuted", 10), said, narration(10), ...Array.from({ length: 3 }, () => real("electrocuted", 11.5))]
  }
  const ok = checkScript(good, limits, [{ words, excluded: [] }])
  assert.deepEqual(ok.problems, [])
  assert.deepEqual(ok.script.beats[2], said, "kept as skipped")
  const bad: Script = { headline: null, beats: [{ ...said }, narration(70), real("electrocuted", 11.5), said] }
  const text = checkScript(bad, limits, [{ words, excluded: [] }]).problems.join("\n")
  assert.match(text, /the hook can't be skipped/)
  assert.match(text, /is skipped, so a narrated line that plays must come straight after it/)
})

const recap = SCRIPT_LIMITS["story-recap"]!
// the payoff: three sentences a second or two apart, 13 s in all
const payoffWords = [
  ...say(100, "Here comes the ice cream, spiked with twenty million Scoville."),
  ...say(106, "Oh no. Oh no no no."),
  ...say(110, "Give me all the milk right now please.")
]
const recapWords = [...say(10, "I am not scared of anything."), ...say(20, "It's like getting electrocuted."), ...payoffWords]

test("story-recap: 150–220 words, 5–8 real lines, and the payoff merged into one long take", () => {
  const script: Script = {
    headline: null,
    beats: [
      narration(180),
      ...Array.from({ length: 5 }, (_, i) => [real(i % 2 === 0 ? "not scared" : "electrocuted", i % 2 === 0 ? 11 : 21), narration(2)]).flat(),
      real("ice cream", 101),
      real("oh no", 106),
      real("all the milk", 112)
    ]
  }
  const { script: checked, problems } = checkScript(script, recap, [{ words: recapWords, excluded: [] }])
  assert.deepEqual(problems, [])
  const ending = checked.beats.at(-1)!
  assert.equal(checked.beats.filter((b) => b._tag === "Real").length, 6, "the three ending lines are one take")
  assert.ok(ending._tag === "Real" && ending.start === 99.95 && ending.end === 114.05, JSON.stringify(ending))
  assert.ok(ending._tag === "Real" && ending.quote.startsWith("Here comes") && ending.quote.endsWith("please."), "every word between them")
})

test("story-recap: too few words and reals, an ending that's too short, or no real ending, are problems", () => {
  const short: Script = { headline: null, beats: [narration(100), real("not scared", 11), narration(5), real("electrocuted", 21)] }
  const text = checkScript(short, recap, [{ words: recapWords, excluded: [] }]).problems.join("\n")
  assert.match(text, /narration is 105 words; this approach needs 150–220/)
  assert.match(text, /there are 2 real lines; this approach needs 6–9: 5–8 during the narration, then the payoff take/)
  assert.match(text, /beat 4: the payoff take lasts 2\.1s; this approach ends on one continuous real take of 10–25s/)
  const noEnding: Script = { headline: null, beats: [narration(160), real("ice cream", 101), narration(10)] }
  assert.match(checkScript(noEnding, recap, [{ words: recapWords, excluded: [] }]).problems.join("\n"), /the script ends on the payoff/)
})

test("story-recap: an ending take over 25 s is too long", () => {
  const sentence = (n: number) => `${Array.from({ length: 15 }, (_, i) => `s${n}w${i}`).join(" ")} end.`
  // three 8 s sentences 2 s apart: one 28 s take
  const words = [...say(100, sentence(1)), ...say(110, sentence(2)), ...say(120, sentence(3))]
  const script: Script = { headline: null, beats: [narration(180), real("s1w3 s1w4", 101.5), real("s2w3", 111.5), real("s3w3", 121.5)] }
  assert.match(checkScript(script, recap, [{ words, excluded: [] }]).problems.join("\n"), /the ending \(beats 2–4\): the payoff take lasts 28\.\ds; this approach ends on one continuous real take of 10–25s/)
})
