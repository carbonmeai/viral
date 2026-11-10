import type { Thumbnail } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { describeThumbnailChange } from "./thumbnail-changes.ts"

const thumb = (words: ReadonlyArray<string>, heroSrc: number, layout: "bold" | "classic" = "bold"): Thumbnail => ({
  proposal: null,
  image: null,
  config: { layout, source: "a.mp4", background: { src: 1 }, hero: { src: heroSrc, y: 0 }, lines: words.map((text) => ({ text })) }
})

test("words and the hero moment are compared; the same thumbnail is no card", () => {
  const change = describeThumbnailChange(thumb(["ONE CANDY"], 100), thumb(["EVERY TASTE"], 141), () => "Candy")!
  assert.deepEqual(change.lines.map((l) => [l.label, l.old, l.new]), [["Words", "ONE CANDY", "EVERY TASTE"], ["Hero", "Candy 1:40", "Candy 2:21"]])
  assert.equal(describeThumbnailChange(thumb(["A"], 1, "classic"), thumb(["A"], 1), () => "Candy")!.headline, "Changed the layout")
  assert.equal(describeThumbnailChange(thumb(["A"], 1), thumb(["A"], 1), () => "Candy"), null)
})
