import assert from "node:assert/strict"
import { test } from "node:test"
import { buildShotsBrief, SHOTS_PROMPT } from "./shots-prompt.ts"

test("the stage prompt names both tools", () => {
  assert.match(SHOTS_PROMPT, /`contact_sheet`/)
  assert.match(SHOTS_PROMPT, /`propose_shots`/)
})

test("the brief numbers the voiceover words and shows where the real lines play", () => {
  const words = ["This", "guy.", "It", "hurt."].map((w, i) => ({ w, s: i, e: i + 0.5 }))
  const brief = buildShotsBrief({
    title: "Candy",
    approach: "claim-interleaved",
    framing: "full",
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
