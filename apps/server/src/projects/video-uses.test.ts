import type { Script, ShotPlan, Thumbnail } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { removalProblem, videoUses } from "./video-uses.ts"

const script = {
  headline: null,
  beats: [{ _tag: "Narration", text: "n" }, { _tag: "Real", quote: "q", start: 1, end: 2, source: 1 }]
} as unknown as Script
const shotPlan = {
  shots: [{ word: 0, src: 1, note: "", wordText: "w", frame: null }],
  markers: [],
  highlights: [],
  inserts: [],
  outro: [{ start: 1, end: 2, quote: "q", source: 2, frame: null }],
  storyboard: null
} satisfies ShotPlan
const thumbnail = {
  proposal: null,
  image: null,
  config: { layout: "bold", source: "/a", sources: ["/b"], background: { src: 1 }, hero: { src: 1, y: 0.5 }, inset: { src: 2, y: 1, source: 1 }, lines: [] }
} satisfies Thumbnail

test("lists which steps use each video", () => {
  const uses = videoUses({ script, shotPlan, thumbnail })
  assert.deepEqual(uses.get(0), ["shots", "thumbnail"])
  assert.deepEqual(uses.get(1), ["script", "thumbnail"])
  assert.deepEqual(uses.get(2), ["shots"])
  assert.equal(videoUses({}).size, 0)
})

test("names the steps that keep a video in the short", () => {
  const names = ["Candy", "Heidi Klum", "Gum", "Spare"]
  assert.equal(
    removalProblem({ script, thumbnail }, 1, names),
    "\"Heidi Klum\" can't be removed: the script and the thumbnail use it. Change those steps so they don't use it first."
  )
  assert.equal(removalProblem({ thumbnail }, 1, names), "\"Heidi Klum\" can't be removed: the thumbnail uses it. Change that step so it doesn't use it first.")
  assert.equal(removalProblem({ script }, 0, names), "\"Candy\" can't be removed while the script uses \"Heidi Klum\", which was added after it.")
  assert.equal(removalProblem({ script, shotPlan }, 3, names), null, "a video nothing uses, last in the short")
})
