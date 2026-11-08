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

test("a short from several videos labels each video, its ads, sheets and lines, and asks for a context cut", () => {
  const transcript = (text: string, start: number) => ({
    source: "x",
    language: "en",
    segments: [{ start, end: start + 2, text, words: [{ w: text, s: start, e: start + 2 }] }]
  })
  const brief = buildSectionsBrief({
    creatorBrief: "The candy, then the costume.",
    title: "Extreme candy",
    channel: "NileBlue",
    angle: null,
    story: null,
    excluded: [],
    sourceSeconds: 100,
    sheets: [],
    transcript: "",
    videos: [
      { title: "Extreme candy", channel: "NileBlue", seconds: 100, transcript: transcript("so sour", 12), excluded: [], sheets: ["- /a/sheet.png  (0–100s)"] },
      { title: "Halloween party", channel: "Heidi", seconds: 34, transcript: transcript("look at my hand", 5), excluded: [{ start: 0, end: 3, kind: "intro" }], sheets: [] }
    ],
    beats: [{ source: 1, start: 4, end: 9, beat: "result", summary: "the hand", quotes: [] }]
  })
  assert.ok(brief.startsWith("The creator's brief for this short: The candy, then the costume."))
  assert.match(brief, /V2 "Halloween party" \(Heidi, 0:34\)/)
  assert.match(brief, /Excluded ranges in V2.*0–3s \(intro\)/)
  assert.match(brief, /\[V2 5\.0–7\.0\] look at my hand/)
  assert.match(brief, /\[V2 4\.0–9\.0\] result: the hand/)
  assert.match(brief, /context cut/)
  assert.match(brief, /\/a\/sheet\.png/)
})
