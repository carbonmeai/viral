import type { Run, StageRun } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { memberState, proposalVideos, setPhase, videoColor, videoLabel } from "./set-values.ts"

const run = (status: Run["status"], error: string | null = null) => ({ status, error }) as Run
const stage = (name: StageRun["stage"], status: StageRun["status"]) => ({ stage: name, status, attempt: 1 }) as StageRun

test("videos are V1…V10 with a colour each, the same for the same position", () => {
  assert.equal(videoLabel(0), "V1")
  assert.equal(videoLabel(9), "V10")
  assert.equal(new Set(Array.from({ length: 10 }, (_, i) => videoColor(i))).size, 10)
  assert.equal(videoColor(1), videoColor(11))
})

test("a set's video: being read with its step, read, stopped, or not started", () => {
  const reading = memberState({ ready: false }, run("running"), [stage("source", "reused"), stage("transcribe", "running")])
  assert.deepEqual(reading, { _tag: "reading", step: "Transcribing", done: 1, of: 4 })
  assert.deepEqual(memberState({ ready: true }, run("completed"), []), { _tag: "ready" })
  assert.deepEqual(memberState({ ready: true }, null, []), { _tag: "ready" })
  assert.deepEqual(memberState({ ready: false }, run("failed", "transcribe (x): no audio"), []), { _tag: "failed", error: "transcribe (x): no audio" })
  assert.deepEqual(memberState({ ready: false }, null, []), { _tag: "waiting" })
})

test("the set reads its videos, then proposes", () => {
  assert.equal(setPhase(run("running"), [], false), "reading")
  assert.equal(setPhase(run("running"), [stage("set-story", "running")], false), "proposing")
  assert.equal(setPhase(run("completed"), [stage("set-story", "succeeded")], true), "proposed")
  assert.equal(setPhase(run("failed"), [], false), "stopped")
  assert.equal(setPhase(null, [], false), "new")
  assert.deepEqual(proposalVideos([2, 0, 2]), [0, 2])
})
