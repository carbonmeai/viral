import type { CutPlan } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { changeCount, draftOf, move, nudge, nudgeSentence, proposalOf, searchTranscript, searchVideos, sectionBlocks, sectionFrom, snapSection, stillKey, totalSeconds, videoOfSection } from "./sections-values.ts"

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

// a second video: "Look at my hand." from 4s
const other = ["Look", "at", "my", "hand."].map((w, i) => ({ w, s: 4 + i * 0.5, e: 4 + i * 0.5 + 0.4 }))
const videos = [{ words, sourceSeconds: 60, excluded: [] }, { words: other, sourceSeconds: 30, excluded: [{ start: 0, end: 2 }] }]

test("a short from two videos: the search covers both, a found line keeps its video, and the edit sends it", () => {
  const found = searchVideos(videos, "hand")
  assert.deepEqual(found.map((m) => [m.source, m.text]), [[1, "Look at my hand."]])
  const added = sectionFrom(found[0]!, "payoff", other, 30, found[0]!.source)
  assert.equal(added.source, 1)
  assert.equal("source" in sectionFrom(searchTranscript(words, "spice")[0]!, "conflict", words, duration, 0), false, "V1 is left out")
  const original = draftOf(plan)
  const draft = { ...original, sections: [...original.sections, added] }
  assert.equal(changeCount(original, draft), 1)
  assert.deepEqual(proposalOf(draft).sections[2], { beat: "payoff", start: added.start, end: added.end, note: "added in the editor", source: 1 })
  // moving a section to another video is a change
  const moved = { ...original, sections: [{ ...original.sections[0]!, source: 1 }, original.sections[1]!] }
  assert.equal(changeCount(original, moved), 1)
  assert.equal(videoOfSection(videos, added), videos[1])
  assert.equal(videoOfSection(videos, { source: 7 }), videos[0], "an unknown video falls back to the first")
  assert.deepEqual(sectionBlocks(draft.sections).map((b) => b.source), [0, 0, 1])
  assert.equal(stillKey(1, 4.4), "1:4")
  assert.equal(stillKey(undefined, 4.6), "0:5")
})

test("a section's edge steps a whole sentence at a time", () => {
  // "We tried it. It totally worked. Then we went home." a word every half second from 10 s
  const said = "We tried it. It totally worked. Then we went home.".split(" ").map((w, i) => ({ w, s: 10 + i * 0.5, e: 10 + i * 0.5 + 0.4 }))
  const section = { key: "s", beat: "hook" as const, start: 11.44, end: 13, note: "", text: "It totally worked.", frame: "f.jpg" }
  const later = nudgeSentence(section, "end", 1, said, 60)
  assert.equal(later.text, "It totally worked. Then we went home.")
  assert.equal(later.frame, "f.jpg", "a moved end keeps the frame")
  const earlier = nudgeSentence(section, "start", -1, said, 60)
  assert.equal(earlier.text, "We tried it. It totally worked.")
  assert.equal(earlier.frame, null)
  assert.equal(nudgeSentence(section, "start", 1, said, 60), section, "no later sentence starts inside it")
})
