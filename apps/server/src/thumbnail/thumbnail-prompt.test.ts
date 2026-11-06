import assert from "node:assert/strict"
import { test } from "node:test"
import { buildThumbnailBrief, THUMBNAIL_PROMPT } from "./thumbnail-prompt.ts"

test("the stage prompt names its three tools and the fraction crops", () => {
  for (const tool of ["contact_sheet", "preview_thumbnail", "propose_thumbnail"]) assert.match(THUMBNAIL_PROMPT, new RegExp(`\`${tool}\``))
  assert.match(THUMBNAIL_PROMPT, /\[left, top, right, bottom\], each 0–1/)
})

test("the brief carries the short, the video's frame size, the story, the ads and the sheets", () => {
  const brief = buildThumbnailBrief({
    title: "He Put 7 Tastes Into 1 Candy",
    alternates: ["One Candy, 7 Tastes"],
    video: { title: "Extreme candy", channel: "NileBlue", width: 854, height: 480 },
    lines: ["NARRATOR: This guy made a candy."],
    story: null,
    excluded: [{ start: 2158, end: 2296 }],
    sourceSeconds: 2296,
    sheets: ["- /x/sheet_000.png  (0–315s)"]
  })
  assert.match(brief, /The short: "He Put 7 Tastes Into 1 Candy" \(also tried: "One Candy, 7 Tastes"\)/)
  assert.match(brief, /frames 854×480/)
  assert.match(brief, /NARRATOR: This guy made a candy\./)
  assert.match(brief, /Excluded ranges \(never use\): 2158\.0–2296\.0s/)
  assert.match(brief, /sheet_000\.png/)
})
