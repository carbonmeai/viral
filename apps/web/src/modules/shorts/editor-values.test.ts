import type { Script, StageRun } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { editorSteps, layoutTimeline, narratedWords, narrationEnds, openingStep, realLines, shortTimeOf, sourceStretches, spendText, stepSpend, stepStates, withStoredCosts } from "./editor-values.ts"

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
  assert.deepEqual([...states.entries()], [["script", "done"], ["voice", "done"], ["shots", "waiting"], ["music", "done"], ["render", "next"], ["publish", "next"], ["thumbnail", "next"]])
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

test("the source strip joins each video's touching pieces of the short", () => {
  const strip = sourceStretches([
    { start: 0, end: 2, source: 0 },
    { start: 2, end: 3.5, source: 0 },
    { start: 3.5, end: 5, source: 1 },
    { start: 5, end: 6, source: 0 },
    { start: 7, end: 7, source: 1 }
  ], 3)
  assert.deepEqual(strip, [[{ start: 0, end: 3.5 }, { start: 5, end: 6 }], [{ start: 3.5, end: 5 }], []])
})

const spent = (id: string, name: StageRun["stage"], attempt: number, costUsd: number | null, more: Partial<StageRun> = {}) =>
  ({ id, stage: name, status: "succeeded", attempt, costUsd, ttsCharacters: null, model: null, provider: null, billing: null, ...more }) as unknown as StageRun

test("a step's cost is every try in the run, shown per try when there were several", () => {
  const thumb = stepSpend([spent("t1", "thumbnail", 1, 0.17), spent("m", "metadata", 1, 0.02), spent("t2", "thumbnail", 2, 0.4)], ["thumbnail"])
  assert.equal(thumb.tries.length, 2)
  assert.equal(spendText(thumb), "$0.57 · 2 tries ($0.17, $0.40)")
  assert.equal(spendText(stepSpend([spent("s", "script", 1, 0.17)], ["script"])), "$0.17")
  // assemble + render once is one try; a program's step costs nothing
  const render = stepSpend([spent("a", "assemble", 1, null), spent("r", "render", 1, null)], ["assemble", "render"])
  assert.equal(render.tries.length, 1)
  assert.equal(spendText(render), null)
  // the voice counts characters across its takes
  assert.equal(stepSpend([spent("v1", "voice", 1, null, { ttsCharacters: 300 }), spent("v2", "voice", 2, null, { ttsCharacters: 310 })], ["voice"]).characters, 610)
})

test("an attempt waiting at its gate keeps the cost the workspace load saw", () => {
  // live events sent the row when it started (no cost yet); the workspace was loaded once the gate was raised
  const live = [spent("t1", "thumbnail", 1, 0.17, { status: "failed" }), spent("t2", "thumbnail", 2, null, { status: "running" })]
  const stored = [spent("t1", "thumbnail", 1, 0.17, { status: "failed" }), spent("t2", "thumbnail", 2, 0.4, { status: "waiting", billing: "subscription" })]
  const merged = withStoredCosts(live, stored)
  assert.equal(spendText(stepSpend(merged, ["thumbnail"])), "$0.57 · 2 tries ($0.17, $0.40)")
  assert.equal(merged[1]?.billing, "subscription")
  assert.equal(merged[1]?.status, "running")
  // a finished live row wins
  assert.equal(withStoredCosts([spent("t2", "thumbnail", 2, 0.45)], stored)[0]?.costUsd, 0.45)
})
