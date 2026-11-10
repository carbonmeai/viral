import type { ThumbConfig } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { changedLines, inputNames, momentsOf, optionInUse, optionNote, roundCost, withWords, wordsOf } from "./thumbnail-values.ts"

const config: ThumbConfig = {
  layout: "bold",
  source: "/x/source.mp4",
  background: { src: 5 },
  hero: { src: 1632, y: 0.47 },
  inset: { src: 1694.25, y: 0.8 },
  lines: [{ text: "IT BROKE", color: "#FFD400", size: 210 }, { text: "HIM", color: "#FFFFFF", size: 220 }]
}

test("edited words keep each line's colour and size, in capitals, and an emptied line goes", () => {
  const words = ["it really broke", "HIM"]
  assert.equal(changedLines(config, wordsOf(config)), 0)
  assert.equal(changedLines(config, words), 1)
  assert.deepEqual(withWords(config, words).lines, [
    { text: "IT REALLY BROKE", color: "#FFD400", size: 210 },
    { text: "HIM", color: "#FFFFFF", size: 220 }
  ])
  assert.deepEqual(withWords(config, ["IT BROKE", " "]).lines.map((l) => l.text), ["IT BROKE"])
})

test("a bold thumbnail is made from the hero and the face; classic also uses a background frame", () => {
  assert.deepEqual(momentsOf(config).map((m) => m.name), ["Hero", "Face"])
  assert.deepEqual(momentsOf({ ...config, layout: "classic" }).map((m) => [m.name, m.t]), [["Hero", 1632], ["Face", 1694.25], ["Background", 5]])
})

test("each moment says which of the short's videos it's from", () => {
  const two: ThumbConfig = { ...config, sources: ["/x/two.mp4"], inset: { ...config.inset!, source: 1 } }
  assert.deepEqual(momentsOf(two).map((m) => [m.name, m.source]), [["Hero", 0], ["Face", 1]])
})

test("an AI round names its frames, says each option's faces or why it wasn't made, and its cost before Generate", () => {
  const inputs = [
    { file: "input-1-reaction.jpg", role: "reaction", src: 10 },
    { file: "input-2-reaction.jpg", role: "reaction", src: 20 },
    { file: "input-3-hero.jpg", role: "hero", src: 12 },
    { file: "input-4-graphic.jpg", role: "graphic", src: 25 }
  ] as const
  assert.deepEqual(inputNames(inputs), ["Reaction 1", "Reaction 2", "Hero", "Graphic"])
  assert.equal(optionNote({ image: "option-1.jpg", failure: null, faces: 8.6, note: "his face" }), "Faces 9/10 · his face")
  assert.equal(optionNote({ image: null, failure: "The image model refused it: moderated.", faces: null, note: null }), "The image model refused it: moderated.")
  assert.equal(roundCost(), "3 images · about 3,735 credits (≈ $0.75)")
  const round = { chosen: null, recommended: 3 } as const
  assert.equal(optionInUse(round as never), 3)
  assert.equal(optionInUse({ ...round, chosen: 1 } as never), 1)
})
