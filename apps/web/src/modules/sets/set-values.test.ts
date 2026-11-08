import type { Run, StageRun } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { memberState, proposalMoment, proposalVideos, reorder, setPhase, videoColor, videoLabel } from "./set-values.ts"

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

test("each proposal card shows a different moment: its own video and beat where the story has them", () => {
  const beat = (source: number, start: number) => ({ source, start })
  const story = {
    beats: [beat(0, 1), beat(0, 20), beat(1, 5), beat(1, 30), beat(2, 7)],
    proposals: [{ sources: [0, 1] }, { sources: [0, 1] }, { sources: [1, 2] }]
  }
  assert.deepEqual(proposalMoment(story, 0), { source: 0, t: 1 })
  assert.deepEqual(proposalMoment(story, 1), { source: 1, t: 30 })
  assert.deepEqual(proposalMoment(story, 2), { source: 1, t: 5 })
  // a video with no beat falls to the next one it uses; no beats at all, no moment
  assert.deepEqual(proposalMoment({ beats: [beat(1, 9)], proposals: [{ sources: [0, 1] }] }, 0), { source: 1, t: 9 })
  assert.equal(proposalMoment({ beats: [], proposals: [{ sources: [0, 1] }] }, 0), null)
})

test("dragging a video moves it to its new place, the others closing up", () => {
  assert.deepEqual(reorder(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"])
  assert.deepEqual(reorder(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"])
  const same = ["a", "b"]
  assert.equal(reorder(same, 1, 1), same)
  assert.equal(reorder(same, 0, 5), same)
})
