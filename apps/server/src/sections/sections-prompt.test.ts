import assert from "node:assert/strict"
import { test } from "node:test"
import { buildSectionsBrief, SECTIONS_PROMPT } from "./sections-prompt.ts"

test("the stage prompt names its tools", () => {
  for (const tool of ["`contact_sheet`", "`preview_sections`", "`propose_sections`"]) assert.ok(SECTIONS_PROMPT.includes(tool), tool)
})

test("the brief carries the angle, the story beats, the excluded ranges and the transcript", () => {
  const brief = buildSectionsBrief({
    title: "Extreme candy",
    channel: "NileBlue",
    angle: { title: "The Candy That Broke His Brain", hook: "This candy short-circuits your brain", why: "his own lines work" },
    story: { summary: "He makes candy.", beats: [{ beat: "goal", start: 0, end: 60, summary: "every taste", quotes: [] }], proposals: [] },
    excluded: [{ start: 2158, end: 2270 }],
    sourceSeconds: 2296,
    sheets: ["- /x/sheet_000.png  (0–315s)"],
    transcript: "[1993.6–1995.8] it literally is all the taste at the same time."
  })
  assert.match(brief, /Video: Extreme candy \(by NileBlue\), 2296\.0s long/)
  assert.match(brief, /hook: This candy short-circuits your brain/)
  assert.match(brief, /- goal 0\.0–60\.0s: every taste/)
  assert.match(brief, /Excluded ranges \(never use\): 2158\.0–2270\.0s/)
  assert.match(brief, /\[1993\.6–1995\.8\] it literally/)
})
