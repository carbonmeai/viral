import type { Script } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { describeScriptChange, scriptChecks } from "./script-changes.ts"

const script: Script = {
  headline: ["HOW FAR", "WOULD YOU GO?"],
  beats: [
    { _tag: "Narration", text: "What does it take to create something truly unforgettable?" },
    { _tag: "Narration", text: "One candy engineer wanted a candy hitting every taste at once." },
    { _tag: "Real", quote: "I think I can fit my body inside", start: 21, end: 24, source: 1 },
    { _tag: "Narration", text: "Then it worked." }
  ]
}
const names = (i: number) => ["Candy", "Heidi"][i] ?? `V${i + 1}`

test("a rewritten hook is exactly one changed line, old struck and new shown", () => {
  const next: Script = { ...script, beats: [{ _tag: "Narration", text: "How far would you go for one candy that hits every taste at once?" }, ...script.beats.slice(1)] }
  const change = describeScriptChange(script, next, names)!
  assert.equal(change.headline, "Changed line 1")
  assert.equal(change.lines[0]!.old, "What does it take to create something truly unforgettable?")
  assert.equal(change.lines[0]!.new, "How far would you go for one candy that hits every taste at once?")
  assert.match(change.lines.at(-1)!.note ?? "", /23 → 28 words/)
})

test("an added real line names its video, a removed one shows struck, and nothing changed is no card", () => {
  const next: Script = { ...script, beats: [...script.beats.slice(0, 3), { _tag: "Real", quote: "ten or twenty hands", start: 14, end: 16, source: 1 }] }
  const change = describeScriptChange(script, next, names)!
  assert.ok(change.lines.some((l) => l.label === "Line 4 · real, Heidi" && l.old === "Then it worked." && l.new === "“ten or twenty hands”"))
  assert.equal(describeScriptChange(script, script, names), null)
})

test("the checks carry this script's numbers and the approach's limits", () => {
  const checks = scriptChecks(script, "question-recap").map((c) => c.text)
  assert.ok(checks.includes("23 words, inside 80–130"))
  assert.ok(checks.includes("Real lines only after the narration"))
  assert.ok(!scriptChecks(script, "claim-interleaved").some((c) => c.text === "Real lines only after the narration"))
})
