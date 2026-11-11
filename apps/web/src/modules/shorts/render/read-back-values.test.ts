import type { ReadBack } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkToggleLabel, momentOf, readBackView } from "./read-back-values.ts"

const heard: ReadBack = {
  provider: "whisper-local",
  seconds: 7.4,
  transcript: "/x/read-back/transcript.json",
  problem: null,
  checks: [
    { kind: "heard", ok: true, text: "Heard 140 of the 146 words the short should say (96%)", at: null },
    { kind: "narration", ok: true, text: "The narration reads as written (129 words)", at: null },
    { kind: "real-line", ok: false, text: "Real line 2 stops mid-sentence (the sentence goes on: “oh my god”)", at: 45.1 },
    { kind: "closing", ok: true, text: "The closing question and the subscribe line are heard", at: 52.64 },
    { kind: "silence", ok: false, text: "Silent for 1.8 s", at: 61.25 }
  ]
}

test("the Render step's read-back: things to look at first, each with its moment to click", () => {
  const view = readBackView(heard)
  assert.equal(view.summary, "2 things to look at")
  assert.equal(view.tone, "warn")
  assert.equal(view.note, "Local Whisper · 7 s")
  assert.deepEqual(view.rows.map((r) => [r.ok, r.time]), [[false, "0:45.1"], [false, "1:01.3"], [true, null], [true, null], [true, "0:52.6"]])
  assert.equal(view.rows[0]!.at, 45.1)
})

test("every check passing, Grok, and a read-back that didn't run", () => {
  const ok = readBackView({ ...heard, provider: "grok", checks: heard.checks.filter((c) => c.ok) })
  assert.equal(ok.summary, "All 3 checks passed")
  assert.equal(ok.tone, "ok")
  assert.equal(ok.note, "Grok · 7 s")
  const off = readBackView({ provider: null, seconds: 0, transcript: null, checks: [], problem: "turned off (VIRAL_READ_BACK=off)" })
  assert.deepEqual(off, { summary: "Not read back", tone: "off", rows: [], note: "turned off (VIRAL_READ_BACK=off)" })
})

test("the toggle under the player says what to look at; moments read to a tenth", () => {
  assert.equal(checkToggleLabel(heard), "Check sheet · 2 to look at")
  assert.equal(checkToggleLabel(undefined), "Check sheet")
  assert.equal(checkToggleLabel({ ...heard, checks: [] }), "Check sheet")
  assert.equal(momentOf(5), "0:05.0")
  assert.equal(momentOf(127.84), "2:07.8")
})
