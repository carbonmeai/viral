import type { ThumbnailProposal } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkConfig, checkThumbnail, fromProposedThumbnail, thumbConfig } from "./thumbnail-rules.ts"

const ctx = { width: 854, height: 480, sourceSeconds: 2296, excluded: [{ start: 2158, end: 2296 }] }
const v1 = [{ ...ctx, path: "/v/source.mp4" }]
// the hand-made candy thumbnail, as fractions
const candy: ThumbnailProposal = {
  layout: "classic",
  background: { src: 1935 },
  hero: { src: 1632, crop: [0.2, 0, 0.95, 1], circle: { x: 0.5, y: 0.51, r: 0.27 } },
  face: { src: 1807.3, crop: [0.27, 0, 0.83, 0.9], },
  lines: [{ text: "7 tastes", color: "yellow" }, { text: "1 candy", color: "white" }]
}

test("the candy thumbnail passes and becomes the renderer's config in pixels", () => {
  const { value, problems } = checkThumbnail(candy, [ctx])
  assert.deepEqual(problems, [])
  assert.deepEqual(value.lines.map((l) => l.text), ["7 TASTES", "1 CANDY"], "upper-cased")
  const config = thumbConfig(value, v1)
  assert.deepEqual(config.hero.box, [171, 0, 811, 480])
  assert.equal(config.hero.circle, true)
  assert.deepEqual(config.inset?.box, [231, 0, 709, 432])
  assert.deepEqual(config.lines, [{ text: "7 TASTES", color: "#FFD400", size: 220 }, { text: "1 CANDY", color: "#FFFFFF", size: 180 }])
  assert.equal(config.source, "/v/source.mp4")
})

test("reports moments in the ads, bad crops, and text that's too long or too short", () => {
  const text = checkThumbnail({
    layout: "classic",
    background: { src: 2200 },
    hero: { src: 9999, crop: [0.5, 0, 0.6, 1], circle: { x: 2, y: 0.5, r: 0.8 } },
    face: { src: 100, crop: [0.8, 0, 0.2, 1] },
    lines: [{ text: "the most extreme candy ever made", color: "red" }]
  }, [ctx]).problems.join("\n")
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
  const { value, problems } = checkThumbnail({ ...candy, face: null, hero: { ...candy.hero, circle: null } }, [ctx])
  assert.deepEqual(problems, [])
  const config = thumbConfig(value, v1)
  assert.equal(config.inset, undefined)
  assert.equal(config.hero.circle, false)
})

// variation A of the candy thumbnail: the bold layout, the default
const bold: ThumbnailProposal = {
  background: { src: 1632, color: "red" },
  hero: { src: 1632, crop: [0.35, 0.1, 0.82, 1], circle: null },
  face: { src: 1694.25, crop: [0.29, 0.04, 0.66, 1], side: "right" },
  lines: [{ text: "it broke", color: "yellow" }, { text: "him", color: "white" }]
}

test("a bold thumbnail becomes the bold layout: a gradient, cut-outs, the face on its side, an arrow", () => {
  const { value, problems } = checkThumbnail(bold, [ctx])
  assert.deepEqual(problems, [])
  const config = thumbConfig(value, v1)
  assert.equal(config.layout, "bold")
  assert.deepEqual(config.backdrop, { colors: ["#FF3B30", "#3A0000"], burst: true })
  assert.equal(config.inset?.side, "right")
  assert.equal(config.inset?.x, 0.74)
  assert.equal(config.arrow, true, "an arrow when there's no emoji")
  assert.equal(config.emoji, undefined)

  const withEmoji = thumbConfig(checkThumbnail({ ...bold, emoji: "🤢", face: { ...bold.face!, side: "left" } }, [ctx]).value, v1)
  assert.deepEqual(withEmoji.emoji, { char: "🤢", x: 0.8, y: 0.78, size: 250 }, "on the side opposite the face")
  assert.equal(withEmoji.arrow, false)
})

test("bold needs a face and a real emoji, and allows five words", () => {
  const text = checkThumbnail({ ...bold, face: null, emoji: "yuck", lines: [{ text: "worst candy ever", color: "white" }, { text: "made here?", color: "red" }] }, [ctx])
    .problems.join("\n")
  assert.match(text, /needs the video's strongest reaction face/)
  assert.match(text, /"yuck" isn't a single emoji/)
  assert.doesNotMatch(text, /words; use/)
  assert.match(checkThumbnail({ ...bold, lines: [{ text: "a b c", color: "white" }, { text: "d e f", color: "red" }] }, [ctx]).problems.join(), /6 words; use 2–5/)
})

test("each layer is checked in its own video; V1 is stored without a source", () => {
  const wide = { width: 1920, height: 1080, sourceSeconds: 60, excluded: [] }
  const proposal = { ...candy, hero: { ...candy.hero, source: 0 }, face: { ...candy.face!, src: 30, source: 1 } }
  const { value, problems } = checkThumbnail(proposal, [ctx, wide])
  assert.ok(!problems.some((p) => p.includes("outside the video")), problems.join("\n"))
  assert.ok(!("source" in value.hero))
  assert.equal(value.face?.source, 1)
  assert.match(checkThumbnail(proposal, [ctx]).problems.join("\n"), /the face: V2 isn't one of this short's videos \(V1\)/)
})

test("the agent names videos by V number; each layer's crop is in its own video's pixels and the config lists the videos", () => {
  const wide = { width: 1920, height: 1080, sourceSeconds: 60, excluded: [{ start: 50, end: 60 }] }
  const proposal = fromProposedThumbnail({ ...bold, hero: { ...bold.hero, video: 1 }, face: { ...bold.face!, src: 30, video: 2 } })
  assert.ok(!("source" in proposal.hero), "V1 is left out")
  assert.equal(proposal.face?.source, 1)
  const { value, problems } = checkThumbnail(proposal, [ctx, wide])
  assert.deepEqual(problems, [])
  const config = thumbConfig(value, [{ ...ctx, path: "/v/one.mp4" }, { ...wide, path: "/v/two.mp4" }])
  assert.equal(config.source, "/v/one.mp4")
  assert.deepEqual(config.sources, ["/v/two.mp4"])
  assert.ok(!("source" in config.hero))
  assert.equal(config.inset?.source, 1)
  assert.deepEqual(config.inset?.box, [557, 43, 1267, 1080], "the face's crop in V2's 1920×1080 frame")

  // a single-video config has no sources and no layer sources, exactly as before
  const single = thumbConfig(checkThumbnail(bold, [ctx]).value, v1)
  assert.ok(!("sources" in single) && !("source" in single.hero) && !("source" in single.background) && !("source" in single.inset!))

  // an edit is checked in each layer's own video, the problem naming it
  const inAd = checkConfig({ ...config, inset: { ...config.inset!, src: 55 } }, [ctx, wide]).join("\n")
  assert.match(inAd, /the face \(V2\) at 55\.0s is inside an excluded range/)
  assert.match(checkConfig({ ...config, inset: { ...config.inset!, box: [0, 0, 1900, 1200] } }, [ctx, wide]).join(), /the face \(V2\) box/)
  assert.deepEqual(checkConfig({ ...config, inset: { ...config.inset!, box: [0, 0, 1900, 1200] } }, [ctx, wide]).length, 1)
  assert.match(checkConfig(config, [ctx]).join(), /the face: V2 isn't one of this short's videos/)
})
