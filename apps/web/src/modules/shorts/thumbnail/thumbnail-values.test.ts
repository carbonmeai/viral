import type { ThumbConfig } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { changedLines, momentsOf, withWords, wordsOf } from "./thumbnail-values.ts"

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
