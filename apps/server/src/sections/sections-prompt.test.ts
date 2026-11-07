import assert from "node:assert/strict"
import { test } from "node:test"
import { type SectionsBrief, buildSectionsBrief, SECTIONS_PROMPT } from "./sections-prompt.ts"

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

test("the creator's brief comes first when the short has one, and not at all when it doesn't", () => {
  const input: SectionsBrief = {
    title: "Extreme candy",
    channel: "NileBlue",
    angle: { title: "The Candy That Broke His Brain", hook: "This candy short-circuits your brain", why: "his own lines work" },
    story: { summary: "He makes candy.", beats: [{ beat: "goal", start: 0, end: 60, summary: "every taste", quotes: [] }], proposals: [] },
    excluded: [{ start: 2158, end: 2270 }],
    sourceSeconds: 2296,
    sheets: ["- /x/sheet_000.png  (0–315s)"],
    transcript: "[1993.6–1995.8] it literally is all the taste at the same time."
  }
  const withBrief = buildSectionsBrief({ ...input, creatorBrief: "Focus on the friend's reactions." })
  assert.ok(withBrief.startsWith("The creator's brief for this short: Focus on the friend's reactions."))
  for (const none of [null, "   ", undefined]) {
    assert.doesNotMatch(buildSectionsBrief((none === undefined ? input : { ...input, creatorBrief: none })), /creator's brief/)
  }
})
