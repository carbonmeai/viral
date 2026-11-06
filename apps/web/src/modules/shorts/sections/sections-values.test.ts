import type { CutPlan } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { changeCount, draftOf, move, nudge, proposalOf, searchTranscript, sectionBlocks, sectionFrom, snapSection, totalSeconds } from "./sections-values.ts"

// "It worked. The spice killed it. This is so nasty." at a word every half second
const said = ["It", "worked.", "The", "spice", "killed", "it.", "This", "is", "so", "nasty."]
const words = said.map((w, i) => ({ w, s: 10 + i * 0.5, e: 10 + i * 0.5 + 0.4 }))
const duration = 60

const plan: CutPlan = {
  hookText: "It worked",
  sections: [
    { beat: "hook", start: 9.94, end: 10.95, note: "n", text: "It worked.", frame: "frames/section-01.jpg" },
    { beat: "payoff", start: 12.94, end: 14.95, note: "n", text: "This is so nasty.", frame: "frames/section-02.jpg" }
  ],
  storyboard: null
}

test("sections snap to whole words with a little air, like the server's", () => {
  const snapped = snapSection(10.6, 11.3, words, duration)
  assert.deepEqual(snapped.words.map((w) => w.w), ["worked.", "The"])
  assert.equal(snapped.start.toFixed(2), "10.44")
})

test("a nudge always reaches the next word, and a moved start drops the old frame", () => {
  const hook = draftOf(plan).sections[0]!
  const longer = nudge(hook, "end", 0.1, words, duration)
  assert.equal(longer.text, "It worked. The")
  assert.equal(longer.frame, "frames/section-01.jpg", "the end moved, the frame still fits")
  const later = nudge(hook, "start", 0.1, words, duration)
  assert.equal(later.text, "worked.")
  assert.equal(later.frame, null)
  assert.equal(nudge(hook, "start", -1, words, duration).start, 9.94, "nothing earlier to reach: unchanged")
})

test("found lines widen to their sentence and become sections", () => {
  const found = searchTranscript(words, "spice")
  assert.deepEqual(found.map((m) => m.text), ["The spice killed it."])
  assert.deepEqual(searchTranscript(words, "x"), [])
  const added = sectionFrom(found[0]!, "conflict", words, duration)
  assert.equal(added.text, "The spice killed it.")
  assert.equal(added.beat, "conflict")
})

test("changes count moves, removals, edits, additions and the hook text; the proposal drops the editor's fields", () => {
  const original = draftOf(plan)
  assert.equal(changeCount(original, original), 0)
  const swapped = { ...original, sections: move(original.sections, 0, 1) }
  assert.equal(changeCount(original, swapped), 1)
  const removed = { ...original, sections: original.sections.slice(1) }
  assert.equal(changeCount(original, removed), 1)
  const retitled = { ...original, hookText: "So nasty" }
  assert.equal(changeCount(original, retitled), 1)
  assert.deepEqual(proposalOf({ ...original, hookText: "  " }), {
    hookText: null,
    sections: [
      { beat: "hook", start: 9.94, end: 10.95, note: "n" },
      { beat: "payoff", start: 12.94, end: 14.95, note: "n" }
    ]
  })
})

test("blocks lay the sections end to end in the short's seconds", () => {
  const sections = draftOf(plan).sections
  assert.equal(totalSeconds(sections).toFixed(2), "3.02")
  assert.deepEqual(sectionBlocks(sections).map((b) => [b.start.toFixed(2), b.end.toFixed(2)]), [["0.00", "1.01"], ["1.01", "3.02"]])
})
