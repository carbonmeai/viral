import type { ThumbnailProposal } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkThumbnail, thumbConfig } from "./thumbnail-rules.ts"

const ctx = { width: 854, height: 480, sourceSeconds: 2296, excluded: [{ start: 2158, end: 2296 }] }
// the hand-made candy thumbnail, as fractions
const candy: ThumbnailProposal = {
  background: { src: 1935 },
  hero: { src: 1632, crop: [0.2, 0, 0.95, 1], circle: { x: 0.5, y: 0.51, r: 0.27 } },
  face: { src: 1807.3, crop: [0.27, 0, 0.83, 0.9], },
  lines: [{ text: "7 tastes", color: "yellow" }, { text: "1 candy", color: "white" }]
}

test("the candy thumbnail passes and becomes the renderer's config in pixels", () => {
  const { value, problems } = checkThumbnail(candy, ctx)
  assert.deepEqual(problems, [])
  assert.deepEqual(value.lines.map((l) => l.text), ["7 TASTES", "1 CANDY"], "upper-cased")
  const config = thumbConfig(value, "/v/source.mp4", ctx)
  assert.deepEqual(config.hero.box, [171, 0, 811, 480])
  assert.equal(config.hero.circle, true)
  assert.deepEqual(config.inset?.box, [231, 0, 709, 432])
  assert.deepEqual(config.lines, [{ text: "7 TASTES", color: "#FFD400", size: 220 }, { text: "1 CANDY", color: "#FFFFFF", size: 180 }])
  assert.equal(config.source, "/v/source.mp4")
})

test("reports moments in the ads, bad crops, and text that's too long or too short", () => {
  const text = checkThumbnail({
    background: { src: 2200 },
    hero: { src: 9999, crop: [0.5, 0, 0.6, 1], circle: { x: 2, y: 0.5, r: 0.8 } },
    face: { src: 100, crop: [0.8, 0, 0.2, 1] },
    lines: [{ text: "the most extreme candy ever made", color: "red" }]
  }, ctx).problems.join("\n")
  assert.match(text, /the background at 2200\.0s is inside an excluded range/)
  assert.match(text, /the hero at 9999\.0s is outside the video/)
  assert.match(text, /the hero crop is too small/)
  assert.match(text, /the hero crop is 0\.18:1/)
  assert.match(text, /circle's x and y are fractions/)
  assert.match(text, /the face crop \[0\.8, 0, 0\.2, 1\] must be fractions/)
  assert.match(text, /the text is 6 words; use 2–4/)
  assert.match(text, /is 32 characters/)
})

test("a thumbnail without a face or a circle leaves them out", () => {
  const { value, problems } = checkThumbnail({ ...candy, face: null, hero: { ...candy.hero, circle: null } }, ctx)
  assert.deepEqual(problems, [])
  const config = thumbConfig(value, "/v/source.mp4", ctx)
  assert.equal(config.inset, undefined)
  assert.equal(config.hero.circle, false)
})
