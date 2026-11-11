import { openingRank, rankingEntries, type Script } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkScript, rankingLimits, SCRIPT_LIMITS, scriptLimitsFor } from "./script-rules.ts"

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

// the closing question (a style's "End with a comment question"): its own beat, last, outside every other check
const cta = (question: string) => ({ _tag: "Cta" as const, question })
const fourReals = Array.from({ length: 4 }, () => ({ _tag: "Real" as const, quote: "it's like glue", start: 98, end: 99 }))

test("the closing question sits outside the word and real-line budgets", () => {
  // 100 narrated words is the top of claim-interleaved's budget; the closing question's words don't count
  const script: Script = { headline: null, beats: [narration(100), ...fourReals, cta("What's the stickiest candy you've ever eaten?")] }
  const { script: checked, problems } = checkScript(script, limits, [{ words: transcript, excluded: [] }], true)
  assert.deepEqual(problems, [])
  assert.deepEqual(checked.beats.at(-1), cta("What's the stickiest candy you've ever eaten?"))
  assert.equal(checked.beats.filter((b) => b._tag === "Real").length, 4)
})

test("question-recap's real lines at the end still pass with the closing question after them", () => {
  const script: Script = {
    headline: null,
    beats: [narration(90), { _tag: "Real", quote: "it's like glue", start: 100, end: 101 }, cta("Would you eat it?")]
  }
  const { problems } = checkScript(script, SCRIPT_LIMITS["question-recap"]!, [{ words: transcript, excluded: [] }], true)
  assert.deepEqual(problems, [])
})

test("story-recap still ends on the payoff take, with the closing question after it", () => {
  const words = Array.from({ length: 40 }, (_, i) => w(i % 8 === 7 ? "end." : "word", 500 + i * 0.5))
  const real = (start: number, end: number) => ({ _tag: "Real" as const, quote: "word", start, end })
  const script: Script = {
    headline: null,
    beats: [narration(40), real(500, 501), narration(40), real(504, 505), narration(40), real(508, 509), narration(40), real(512, 513),
      narration(20), real(516, 517), narration(5), real(500, 519.8), cta("What's the hottest pepper you've ever eaten?")]
  }
  const text = checkScript(script, SCRIPT_LIMITS["story-recap"]!, [{ words, excluded: [] }], true).problems.join("\n")
  assert.doesNotMatch(text, /ends on the payoff/)
  assert.doesNotMatch(text, /closing question/)
})

test("the style decides: a closing question is required with it on and refused with it off", () => {
  const source = [{ words: transcript, excluded: [] }]
  const without: Script = { headline: null, beats: [narration(70), ...fourReals] }
  assert.match(checkScript(without, limits, source, true).problems.join("\n"), /this style ends with a closing question: add a Cta beat after the payoff/)
  assert.deepEqual(checkScript(without, limits, source, false).problems, [])
  const withIt: Script = { headline: null, beats: [narration(70), ...fourReals, cta("Would you eat it?")] }
  const off = checkScript(withIt, limits, source, false)
  assert.match(off.problems.join("\n"), /doesn't end with a closing question; leave out the Cta beat/)
  assert.equal(off.script.beats.some((b) => b._tag === "Cta"), false)
  assert.deepEqual(checkScript(withIt, limits, source).problems, off.problems, "off by default")
})

test("the closing question goes last, once, as one short question without the ask", () => {
  const source = [{ words: transcript, excluded: [] }]
  const check = (beats: Script["beats"]) => checkScript({ headline: null, beats }, limits, source, true).problems.join("\n")
  assert.match(check([narration(70), cta("Would you eat it?"), ...fourReals]), /the closing question goes last, after the payoff/)
  assert.match(check([narration(70), ...fourReals, cta("Would you?"), cta("Would you eat it?")]), /there are 2 closing questions/)
  assert.match(check([narration(70), ...fourReals, cta("Tell us what you think.")]), /must be one question, ending in "\?"/)
  assert.match(check([narration(70), ...fourReals, cta("Would you eat it? Subscribe for more?")]), /asks more than one question/)
  assert.match(check([narration(70), ...fourReals, cta("Which one? Tell us in the comments?")]), /write only the question; the narrator adds/)
  assert.match(check([narration(70), ...fourReals, cta("Why?")]), /the closing question is 1 words; keep it to 3–14/)
})

// ---- the narrated ranking (approach-narrated-ranking): five entries counted down, one per video ----

const RANKS = ["zero", "one", "two", "three", "four", "five"]
// "Number five, word word …": the entry's opening line, `n` words after the rank
const opening = (rank: number, n: number) => ({ _tag: "Narration" as const, text: `Number ${RANKS[rank]}, ${Array.from({ length: n }, () => "word").join(" ")}` })
const line = (source: number, start = 10) => ({ _tag: "Real" as const, quote: "cotton ball", start, end: start + 1, ...(source === 0 ? {} : { source }) })
// every video says one short sentence at 10 s; V5 (#1) also has its 24-word reveal at 100 s
const sentence = say(10, "She looked like a cotton ball.")
const reveal = say(100, `${Array.from({ length: 23 }, () => "wow").join(" ")} end.`)
const rankingSources = [0, 1, 2, 3, 4].map((i) => ({ words: i === 4 ? [...sentence, ...reveal] : sentence, excluded: [] }))
const revealTake = { _tag: "Real" as const, quote: "wow wow wow", start: 100, end: 101, source: 4 }
const countdown = (order = [5, 4, 3, 2, 1]) => [
  narration(12),
  ...order.flatMap((rank) => [opening(rank, 45), line(5 - rank)]),
  // #1's last narrated line, then its reveal take
  { _tag: "Narration" as const, text: "One month later." },
  revealTake
]
const ranking = rankingLimits(5)

test("narrated ranking: limits grow with the entries", () => {
  assert.deepEqual(ranking.narrationWords, [118, 264])
  assert.deepEqual(ranking.reals, [5, 11])
  assert.equal(scriptLimitsFor("narrated-ranking", 3)?.ranking?.entries, 3)
  assert.equal(scriptLimitsFor("claim-interleaved", 5)?.ranking, undefined)
})

test("narrated ranking: a countdown #5 → #1 with a real line per entry from its own video and #1's reveal passes", () => {
  const { problems, script } = checkScript({ headline: null, beats: countdown() }, ranking, rankingSources)
  assert.deepEqual(problems, [])
  assert.deepEqual(rankingEntries(script.beats, 5).entries.map((e) => e.rank), [5, 4, 3, 2, 1])
  const last = script.beats.at(-1)!
  assert.ok(last._tag === "Real" && last.end - last.start > 10, "the reveal widened to its whole sentence, over 10 s")
})

test("narrated ranking: the hook may tease #1 without starting the countdown", () => {
  const beats = [{ _tag: "Narration" as const, text: "These five animals had no chance." }, { _tag: "Narration" as const, text: "Number one had already given up." }, ...countdown().slice(1)]
  const { hookEnd, entries } = rankingEntries(beats, 5)
  assert.equal(hookEnd, 2)
  assert.deepEqual(entries.map((e) => e.rank), [5, 4, 3, 2, 1])
  assert.equal(openingRank("“Number 3.”"), 3)
  assert.equal(openingRank("The number five"), null)
})

test("narrated ranking: wrong order, a missing entry, and no countdown at all are problems", () => {
  const order = checkScript({ headline: null, beats: countdown([5, 3, 4, 2, 1]) }, ranking, rankingSources).problems.join("\n")
  assert.match(order, /the countdown goes #5, #3, #4, #2, #1; it must be #5, #4, #3, #2, #1/)
  const missing = checkScript({ headline: null, beats: countdown([5, 4, 2, 1]) }, ranking, rankingSources).problems.join("\n")
  assert.match(missing, /the countdown goes #5, #4, #2, #1/)
  const none = checkScript({ headline: null, beats: [narration(200), line(0), revealTake] }, ranking, rankingSources).problems.join("\n")
  assert.match(none, /counts down 5 entries, one per video: open each entry on a narrated line starting "Number five"/)
})

test("narrated ranking: each entry has 1–2 real lines from its own video, a video is one entry, and an entry runs 15–32 s", () => {
  const beats = countdown()
  // #4 has none, #3 has three, #2 borrows V1's line, and the hook plays a real line
  const bad = [
    narration(12), line(0),
    opening(5, 45), line(0),
    opening(4, 45),
    opening(3, 20), line(2), line(2), line(2),
    opening(2, 45), line(0),
    ...beats.slice(-4)
  ]
  const text = checkScript({ headline: null, beats: bad }, ranking, rankingSources).problems.join("\n")
  assert.match(text, /the hook \(everything before "Number five"\) is narration only/)
  assert.match(text, /entry #4 has 0 real lines; each entry cuts in 1–2/)
  assert.match(text, /entry #3 has 3 real lines/)
  assert.match(text, /entries #5 and #2 both use V1; each video is one entry/)
  assert.match(text, /entry #4 runs about 14\.7s \(47 narrated words/)
  const mixed = [...beats.slice(0, 3), line(3), ...beats.slice(3)]
  assert.match(checkScript({ headline: null, beats: mixed }, ranking, rankingSources).problems.join("\n"), /entry #5's real lines come from V1 and V4/)
  const long = [narration(12), opening(5, 100), line(0), ...beats.slice(3)]
  assert.match(checkScript({ headline: null, beats: long }, ranking, rankingSources).problems.join("\n"), /entry #5 runs about 35\.0s .*keep each entry about 20–25 s \(15–32\)/)
})
