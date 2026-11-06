import type { SectionsProposal } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkSections, snapSection } from "./section-rules.ts"

// a word every half second from 0 to 100s: "w0 w1 …"
const words = Array.from({ length: 200 }, (_, i) => ({ w: `w${i}`, s: i * 0.5, e: i * 0.5 + 0.4 }))
const ctx = { words, sourceSeconds: 100, excluded: [{ start: 90, end: 100 }] }

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
      { beat: "rising_action", start: 10, end: 20, note: "the goal" },
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
  assert.match(text, /the short is .*s; keep it 20–60s/)
  assert.match(text, /hook text is 9 words/)
})
