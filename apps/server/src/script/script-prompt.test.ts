import assert from "node:assert/strict"
import { test } from "node:test"
import { buildScriptPrompt, SCRIPT_WRITER_SYSTEM_PROMPT } from "./script-prompt.ts"

test("system prompt names the tool the agent must call", () => {
  assert.match(SCRIPT_WRITER_SYSTEM_PROMPT, /`propose_script`/)
})

test("prompt embeds the trimmed transcript", () => {
  const prompt = buildScriptPrompt("\n  He made a candy.  \n")
  assert.ok(prompt.startsWith("Transcript:\nHe made a candy.\n"))
})
