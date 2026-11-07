import assert from "node:assert/strict"
import { test } from "node:test"
import { type ShotsBrief, buildShotsBrief, SHOTS_PROMPT } from "./shots-prompt.ts"

test("the stage prompt names its tools", () => {
  assert.match(SHOTS_PROMPT, /`contact_sheet`/)
  assert.match(SHOTS_PROMPT, /`preview_shots`/)
  assert.match(SHOTS_PROMPT, /`propose_shots`/)
})

test("the brief numbers the voiceover words and shows where the real lines play", () => {
  const words = ["This", "guy.", "It", "hurt."].map((w, i) => ({ w, s: i, e: i + 0.5 }))
  const brief = buildShotsBrief({
    title: "Candy",
    approach: "claim-interleaved",
    framing: "full",
    shotSeconds: 2.2,
    words,
    narrationEnds: [1, 3],
    inserts: [{ start: 10, end: 12, quote: "Ow.", afterWord: 1, afterWordText: "guy." }],
    outro: [{ start: 20, end: 22, quote: "Nasty." }],
    story: null,
    excluded: [{ start: 0, end: 3 }],
    sourceSeconds: 100,
    sheets: ["- /x/sheet_000.png  (0–315s)"],
    transcript: "[10.0–12.0] Ow."
  })
  assert.match(brief, /Narration 1 \(words 0–1\): 0:This@0\.00 1:guy\.@1\.00/)
  assert.match(brief, /REAL after word 1 "guy\.": "Ow\." \(10\.0–12\.0s\); the narration resumes on word 2/)
  assert.match(brief, /OUTRO after the narration: "Nasty\."/)
  assert.match(brief, /about 2\.2s on average/)
  assert.match(brief, /cropX/)
})

test("the creator's brief comes first when the short has one, and not at all when it doesn't", () => {
  const words = ["This", "guy.", "It", "hurt."].map((w, i) => ({ w, s: i, e: i + 0.5 }))
  const input: ShotsBrief = {
    title: "Candy",
    approach: "claim-interleaved",
    framing: "full",
    shotSeconds: 2.2,
    words,
    narrationEnds: [1, 3],
    inserts: [{ start: 10, end: 12, quote: "Ow.", afterWord: 1, afterWordText: "guy." }],
    outro: [{ start: 20, end: 22, quote: "Nasty." }],
    story: null,
    excluded: [{ start: 0, end: 3 }],
    sourceSeconds: 100,
    sheets: ["- /x/sheet_000.png  (0–315s)"],
    transcript: "[10.0–12.0] Ow."
  }
  const withBrief = buildShotsBrief({ ...input, creatorBrief: "Focus on the friend's reactions." })
  assert.ok(withBrief.startsWith("The creator's brief for this short: Focus on the friend's reactions."))
  for (const none of [null, "   ", undefined]) {
    assert.doesNotMatch(buildShotsBrief((none === undefined ? input : { ...input, creatorBrief: none })), /creator's brief/)
  }
})

test("a short from several videos: real lines name their video, and each video has its sheets and ads", () => {
  const words = ["This", "guy.", "It", "hurt."].map((w, i) => ({ w, s: i, e: i + 0.5 }))
  const transcript = (text: string, start: number) => ({
    source: "x",
    language: "en",
    segments: [{ start, end: start + 1, text, words: [] }]
  })
  const brief = buildShotsBrief({
    title: "Candy",
    approach: "claim-interleaved",
    framing: "band",
    shotSeconds: 2.2,
    words,
    narrationEnds: [1, 3],
    inserts: [{ start: 10, end: 12, quote: "Ow.", source: 1, afterWord: 1, afterWordText: "guy." }],
    outro: [{ start: 20, end: 22, quote: "Nasty." }],
    story: null,
    excluded: [],
    sourceSeconds: 600,
    sheets: [],
    transcript: "unused",
    videos: [
      { title: "Candy", channel: "NileBlue", seconds: 600, transcript: transcript("Nasty.", 20), excluded: [], sheets: ["- /a/sheet_000.png  (0–150s)"] },
      { title: "Acid", channel: "ChemLab", seconds: 300, transcript: transcript("Ow.", 10), excluded: [{ start: 0, end: 5 }], sheets: ["- /b/sheet_000.png  (0–150s)"] }
    ]
  })
  assert.match(brief, /REAL after word 1 "guy\.": "Ow\." \(V2 10\.0–12\.0s\)/)
  assert.match(brief, /OUTRO after the narration: "Nasty\." \(V1 20\.0–22\.0s\)/)
  assert.match(brief, /## V2 "Acid" \(ChemLab, 5:00\)\n\nExcluded ranges in V2 .*0–5s\n\nOverview contact sheets .*\n- \/b\/sheet_000\.png/)
  assert.match(brief, /Each shot names its video/)
})
