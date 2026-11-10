import type { ThumbnailDesign } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { buildImagePrompt, checkDesign, checkPick, designInputs, fromProposedDesign } from "./thumbnail-design.ts"

// The approved spicy thumbnail's design, as the skill recorded it (thumbnails.md §1).
const spicy: ThumbnailDesign = {
  graphic: { src: 17, what: "\"SCOVILLE SCALE\" bar graphic" },
  words: "LEVEL 10",
  hero: { src: 1050.3, what: "yellow Pepper X", dramatise: "cracked open with glowing molten lava inside, held by steel tongs, flames rising" },
  escalation: "8 peppers escalating from a green bell pepper to a flaming red reaper",
  reactions: [
    { src: 880.5, look: "calm, teary" },
    { src: 1108.4, look: "eyes squeezed shut, mouth open, sweating" }
  ],
  person: "a man with a mustache, a chain and an olive military chef jacket with medals",
  prop: "a glass milk jug",
  background: "hyper-saturated fiery red-orange with flames and embers",
  celebrity: null
}
const video = { width: 1920, height: 1080, sourceSeconds: 1500, excluded: [{ start: 0, end: 10 }] }

test("the prompt follows the skill's template: numbered real frames, four bands, faces copied photographically", () => {
  assert.equal(buildImagePrompt(spicy), [
    "Create a vertical 9:16 YouTube Shorts thumbnail. Images 1 and 2 are REAL video frames of the same real person (a man with a mustache, a chain and an olive military chef jacket with medals). Image 3 is the real yellow Pepper X. Image 4 is the real \"SCOVILLE SCALE\" bar graphic.",
    "",
    "Layout top to bottom, filling the frame with no empty space:",
    "1. Very top: the \"SCOVILLE SCALE\" bar graphic from image 4 reproduced faithfully, full width, with its own labels.",
    "2. Below it: huge bold white \"LEVEL 10\" text with a thick black outline. The big text sits fully above the hero; nothing overlaps the letters.",
    "3. Middle: the yellow Pepper X from image 3, huge, cracked open with glowing molten lava inside, held by steel tongs, flames rising. Under it a row of 8 peppers escalating from a green bell pepper to a flaming red reaper.",
    "4. Bottom: the real person TWICE, side by side, big. Left = the person exactly as in image 1 (calm, teary). Right = the person exactly as in image 2 (eyes squeezed shut, mouth open, sweating). Copy both faces photographically from images 1 and 2 — identical face shape, skin, hair and clothes; do not invent, redraw or exaggerate the face. A glass milk jug between them.",
    "",
    "Hyper-saturated fiery red-orange with flames and embers background, MrBeast / Nick DiGiovanni thumbnail style. No other text, no logos."
  ].join("\n"))
  assert.deepEqual(designInputs(spicy).map((i) => i.role), ["reaction", "reaction", "hero", "graphic"])
})

test("without a graphic the words go on top; three reactions are numbered left, middle, right", () => {
  const prompt = buildImagePrompt({
    ...spicy,
    graphic: null,
    escalation: null,
    prop: null,
    reactions: [...spicy.reactions, { src: 1200, look: "laughing" }]
  })
  assert.match(prompt, /Images 1, 2 and 3 are REAL video frames/)
  assert.match(prompt, /1\. Top: huge bold white "LEVEL 10"/)
  assert.match(prompt, /the real person THREE TIMES/)
  assert.match(prompt, /Middle = the person exactly as in image 2/)
  assert.doesNotMatch(prompt, /Under it a row|between them|Image 5/)
})

test("a design is checked: real moments outside the ads, two or three distinct reactions, 1–3 words, every band said", () => {
  assert.deepEqual(checkDesign(spicy, [video]).problems, [])
  const bad = checkDesign({
    ...spicy,
    words: "THE HOTTEST PEPPER EVER",
    hero: { ...spicy.hero, src: 5, dramatise: " " },
    reactions: [spicy.reactions[0]!, { ...spicy.reactions[0]!, src: 880.7 }],
    person: ""
  }, [video]).problems
  assert.deepEqual(bad, [
    "the words are 1–3 words (\"LEVEL 10\", \"TOP 1\"); \"THE HOTTEST PEPPER EVER\" has 4",
    "reactions 1 and 2 are the same moment; pick two contrasting reactions",
    "the hero at 5.0s is inside an excluded range (0.0–10.0s)",
    "describe how the hero is made dramatic",
    "describe how the person looks (face, hair, clothes)"
  ])
  assert.deepEqual(checkDesign({ ...spicy, reactions: [spicy.reactions[0]!] }, [video]).problems, ["use 2–3 real reactions side by side; there are 1"])
})

test("frames from other videos name them; the stored design keeps positions", () => {
  const stored = fromProposedDesign({
    ...spicy,
    graphic: { ...spicy.graphic!, video: 2 },
    hero: { ...spicy.hero, video: 1 },
    reactions: spicy.reactions.map((r) => ({ ...r }))
  })
  assert.equal(stored.graphic?.source, 1)
  assert.equal("source" in stored.hero, false, "V1 is left out")
  assert.match(checkDesign({ ...stored, hero: { ...stored.hero, source: 3 } }, [video, video]).problems.join(), /the hero: V4 isn't one of this short's videos/)
})

test("the agent's pick checks every option made and recommends one of them", () => {
  const options = [{ image: "option-1.jpg" }, { image: null }, { image: "option-3.jpg" }]
  assert.deepEqual(checkPick({ checks: [{ option: 1, faces: 7, note: "" }, { option: 3, faces: 9, note: "" }], recommended: 3 }, options).problems, [])
  assert.deepEqual(checkPick({ checks: [{ option: 1, faces: 7, note: "" }, { option: 2, faces: 12, note: "" }], recommended: 2 }, options).problems, [
    "option 2 isn't one of the images made (1 and 3)",
    "option 2's face score is 0–10",
    "check option 3 too",
    "recommend one of the images made (1 and 3), or null"
  ])
  assert.deepEqual(checkPick({ checks: [], recommended: null }, [{ image: null }]).problems, [], "nothing made, nothing to check")
})
