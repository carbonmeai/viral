import type { Script, StageRun } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { editorSteps, layoutTimeline, narratedWords, narrationEnds, openingStep, realLines, shortTimeOf, stepStates } from "./editor-values.ts"

const stage = (name: StageRun["stage"], status: StageRun["status"], attempt = 1) => ({ stage: name, status, attempt }) as StageRun

test("each step's state comes from its stages, and the editor opens where you're needed", () => {
  const steps = editorSteps("narrated")
  const states = stepStates(steps, [
    stage("script", "failed", 1),
    stage("script", "succeeded", 2),
    stage("voice", "reused"),
    stage("shots", "waiting"),
    stage("assemble", "succeeded")
  ])
  assert.deepEqual([...states.entries()], [["script", "done"], ["voice", "done"], ["shots", "waiting"], ["render", "next"], ["publish", "next"], ["thumbnail", "next"]])
  assert.equal(openingStep(steps, states), "shots")
  assert.equal(openingStep(steps, stepStates(steps, [])), "script")
  assert.deepEqual(editorSteps("cut-down").map((s) => s.id), ["sections", "render", "publish", "thumbnail"])
})

// "This guy tasted it. It hurt." at half a second a word
const words = ["This", "guy", "tasted", "it.", "It", "hurt."].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }))
const script: Script = {
  headline: null,
  beats: [
    { _tag: "Narration", text: "This guy tasted it." },
    { _tag: "Real", quote: "Ow.", start: 40, end: 41 },
    { _tag: "Real", quote: "Hot.", start: 50, end: 50.5 },
    { _tag: "Narration", text: "It hurt." },
    { _tag: "Real", quote: "Nasty.", start: 60, end: 62 }
  ]
}

test("counts and narration ends", () => {
  assert.equal(narratedWords(script), 6)
  assert.equal(realLines(script), 3)
  assert.deepEqual(narrationEnds(script, words), [3, 5])
})

test("the timeline plays real lines after their narration, back to back, and the rest as an outro", () => {
  const layout = layoutTimeline(script, words, 3)
  // "it." ends at 1.9: Ow (1s) then Hot (0.5s) play there; the voiceover resumes at 3.4
  assert.deepEqual(layout.reals.map((r) => [r.label, r.kind, r.start, r.end]), [
    ["Ow.", "insert", 1.9, 2.9],
    ["Hot.", "insert", 2.9, 3.4],
    ["Nasty.", "outro", 4.5, 6.5]
  ])
  assert.deepEqual(layout.narration.map((n) => [n.start, n.end]), [[0, 1.9], [3.5, 4.4]])
  assert.equal(layout.outroStart, 4.5)
  assert.equal(layout.total, 6.5)
  // the voiceover's 2s mark plays after both inserts
  assert.equal(shortTimeOf(layout, 2), 3.5)
  assert.equal(shortTimeOf(layout, 1), 1)
})
