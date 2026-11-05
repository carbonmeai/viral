import assert from "node:assert/strict"
import { test } from "node:test"
import { buildScriptPrompt, SCRIPT_WRITER_PROMPT } from "./script-prompt.ts"

test("the stage prompt names the tool and defers to the skills", () => {
  assert.match(SCRIPT_WRITER_PROMPT, /`propose_script`/)
  assert.match(SCRIPT_WRITER_PROMPT, /narrated-recap/)
})

test("prompt embeds the trimmed transcript", () => {
  const prompt = buildScriptPrompt("\n  He made a candy.  \n")
  assert.ok(prompt.startsWith("Transcript:\nHe made a candy.\n"))
})
