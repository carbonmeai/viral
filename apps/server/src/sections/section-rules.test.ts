import type { SectionsProposal } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkSections, fromProposedSections, snapSection } from "./section-rules.ts"

// a word every half second from 0 to 100s: "w0 w1 …"
const words = Array.from({ length: 200 }, (_, i) => ({ w: `w${i}`, s: i * 0.5, e: i * 0.5 + 0.4 }))
const ctx = [{ words, seconds: 100, excluded: [{ start: 90, end: 100 }] }]

test("a section snaps to the nearest whole words, with air that stops at the neighbours", () => {
  // 10.2 covers half of w20 (10.0–10.4), so w20 stays; 12.1 covers only a quarter of w24 (12.0–12.4), so it goes
  const snapped = snapSection(10.2, 12.1, words, 100)
  assert.deepEqual(snapped.words.map((w) => w.w), ["w20", "w21", "w22", "w23"])
  assert.equal(snapped.start, 10 - 0.06)
  // w23 ends at 11.9; the air after it stops where w24 begins
  assert.equal(snapped.end, 12)
})

test("a start a moment before a word doesn't pull in the word before it", () => {
  // "I get, it literally": the hook should start on "it", and 1993.5 is just inside the end of "get,"
  const said = [{ w: "I", s: 1992.9, e: 1993.1 }, { w: "get,", s: 1993.15, e: 1993.55 }, { w: "it", s: 1993.6, e: 1993.75 }, { w: "literally", s: 1993.8, e: 1994.3 }]
  const snapped = snapSection(1993.5, 1994.3, said, 2296)
  assert.deepEqual(snapped.words.map((w) => w.w), ["it", "literally"])
  assert.equal(snapped.start, 1993.55, "the air before stops at the end of \"get,\"")
})

test("a good plan passes, with each section's words", () => {
  const proposal: SectionsProposal = {
    hookText: "Did it really work?",
    sections: [
      { beat: "hook", start: 60, end: 64, note: "the payoff line" },
      { beat: "rising_action", start: 10, end: 30, note: "the goal" },
      { beat: "payoff", start: 70, end: 78, note: "the result" }
    ]
  }
  const { value, problems } = checkSections(proposal, ctx)
  assert.deepEqual(problems, [])
  assert.match(value.sections[0]!.text, /^w120 w121/)
  assert.equal(value.hookText, "Did it really work?")
})

test("reports a missing hook, short or empty sections, overlaps, ads, length and a long hook text", () => {
  const proposal: SectionsProposal = {
    hookText: "one two three four five six seven eight nine",
    sections: [
      { beat: "rising_action", start: 10, end: 10.3, note: "too short" },
      { beat: "conflict", start: 30, end: 34, note: "a" },
      { beat: "comeback", start: 33, end: 36, note: "overlaps" },
      { beat: "payoff", start: 88, end: 95, note: "into the ad" },
      { beat: "payoff", start: 120, end: 130, note: "past the end" }
    ]
  }
  const text = checkSections(proposal, ctx).problems.join("\n")
  assert.match(text, /first section must be the hook/)
  assert.match(text, /section 1 .* lasts 0\.\ds/)
  assert.match(text, /sections 2 and 3 overlap/)
  assert.match(text, /section 4 .* touches an excluded range \(90\.0–100\.0s\)/)
  assert.match(text, /section 5 .* is outside the video/)
  assert.match(text, /section 5 .* has no speech/)
  assert.match(text, /the short is .*s; keep it 30–120s/)
  assert.match(text, /hook text is 9 words/)
})

test("sections come from their own video, and only the same video's moments can overlap", () => {
  const other = [{ w: "Second", s: 1, e: 1.6 }, { w: "video", s: 1.6, e: 2.2 }, { w: "talking", s: 2.2, e: 3 }]
  const two = [...ctx, { words: other, seconds: 30, excluded: [] }]
  const proposal = {
    hookText: null,
    sections: [
      { beat: "hook" as const, start: 1, end: 3, note: "a" },
      { beat: "payoff" as const, start: 1, end: 3, source: 1, note: "b" },
      { beat: "payoff" as const, start: 1, end: 3, source: 2, note: "c" }
    ]
  }
  const { value, problems } = checkSections(proposal, two)
  assert.equal(value.sections[1]!.source, 1)
  assert.equal(value.sections[1]!.text, "Second video talking")
  assert.ok(!("source" in value.sections[0]!))
  assert.ok(!problems.some((p) => p.includes("overlap")), "the same seconds in two videos aren't the same moment")
  assert.ok(problems.includes("section 3 (payoff V3 1.0–3.0s): V3 isn't one of this short's videos (V1–V2)"))
})

test("the agent's V numbers become positions, and a V2 section is checked against V2's ads and length", () => {
  const other = [{ w: "Second", s: 1, e: 1.6 }, { w: "video", s: 1.6, e: 2.2 }, { w: "talking", s: 2.2, e: 3 }]
  const two = [...ctx, { words: other, seconds: 30, excluded: [{ start: 2, end: 4 }] }]
  const proposal = fromProposedSections({
    hookText: null,
    sections: [
      { beat: "hook", start: 1, end: 3, video: 1, note: "a" },
      { beat: "payoff", start: 1, end: 3, video: 2, note: "b" },
      { beat: "payoff", start: 25, end: 40, video: 2, note: "c" }
    ]
  })
  assert.ok(!("source" in proposal.sections[0]!), "V1 is left out")
  assert.equal(proposal.sections[1]!.source, 1)
  const text = checkSections(proposal, two).problems.join("\n")
  assert.match(text, /section 2 \(payoff V2 1\.0–3\.0s\) touches an excluded range of V2 \(2\.0–4\.0s\)/)
  assert.match(text, /section 3 \(payoff V2 25\.0–40\.0s\) is outside V2 \(0–30\.0s\)/)
})

test("a section that cuts a sentence stretches to keep it whole, or moves past the part it can't keep", () => {
  // "We tried it. It totally worked and everyone cheered. Then we went home." a word every half second from 10 s
  const said = "We tried it. It totally worked and everyone cheered. Then we went home.".split(" ")
    .map((w, i) => ({ w, s: 10 + i * 0.5, e: 10 + i * 0.5 + 0.4 }))
  const videos = [{ words: said, seconds: 60, excluded: [] }]
  // 11.6 starts inside "It totally…" (11.5) and 14.2 ends inside it (14.4): both stretch to the whole sentence
  const { value, problems } = checkSections({ hookText: null, sections: [{ beat: "hook", start: 11.6, end: 14.2, note: "" }] }, videos)
  assert.deepEqual(problems.filter((p) => p.includes("sentence")), [])
  assert.equal(value.sections[0]!.text, "It totally worked and everyone cheered.")
})

test("a style with the comment question needs the end card's question; without it the question is dropped", () => {
  const proposal: SectionsProposal = {
    hookText: null,
    sections: [{ beat: "hook", start: 60, end: 64, note: "hook" }, { beat: "payoff", start: 10, end: 40, note: "story" }]
  }
  assert.match(checkSections(proposal, ctx, true).problems.join("\n"), /this style ends with a comment question: write `question`/)
  const asked = checkSections({ ...proposal, question: " Would you have quit? " }, ctx, true)
  assert.deepEqual(asked.problems, [])
  assert.equal(asked.value.question, "Would you have quit?")
  assert.match(checkSections({ ...proposal, question: "Subscribe for more" }, ctx, true).problems.join("\n"), /ending in "\?"/)
  const off = checkSections({ ...proposal, question: "Would you have quit?" }, ctx)
  assert.deepEqual(off.problems, [])
  assert.equal("question" in off.value, false)
  assert.equal(fromProposedSections({ hookText: null, sections: [], question: "Why not?" }).question, "Why not?")
})
