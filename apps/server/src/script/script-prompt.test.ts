import assert from "node:assert/strict"
import { test } from "node:test"
import { buildScriptPrompt, SCRIPT_WRITER_PROMPT } from "./script-prompt.ts"

test("the stage prompt names the tool and defers to the skills", () => {
  assert.match(SCRIPT_WRITER_PROMPT, /`propose_script`/)
  assert.match(SCRIPT_WRITER_PROMPT, /approach\s+skill/)
})

test("the brief carries the video, its excluded ranges and the timed transcript", () => {
  const prompt = buildScriptPrompt({
    title: "Extreme candy",
    channel: "NileBlue",
    transcript: "[0.0–2.2] This video has been sponsored by Brilliant.",
    excluded: [{ start: 0, end: 3 }],
    angle: { title: "Every taste", hook: "This candy hits every taste at once", why: "a list of reactions" }
  })
  assert.match(prompt, /Video: Extreme candy \(by NileBlue\)/)
  assert.match(prompt, /Never use these ranges.*0–3s/)
  assert.match(prompt, /\[0\.0–2\.2\] This video/)
  assert.match(prompt, /hook: This candy hits every taste at once/)
})
