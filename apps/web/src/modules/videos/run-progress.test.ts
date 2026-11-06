import type { Run, RunRequest, StageRun } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { emptyProgress, foldRun, isActive, latestAttempts } from "./run-progress.ts"

const run = (status: Run["status"]) => ({ id: "r", status }) as unknown as Run
const stage = (id: string, name: StageRun["stage"], status: StageRun["status"], attempt = 1) =>
  ({ id, stage: name, status, attempt }) as unknown as StageRun
const request = (id: string) => ({ id }) as unknown as RunRequest

test("a run's updates fold into one state: snapshot, events, then live progress", () => {
  let state = foldRun(emptyProgress, { _tag: "Snapshot", run: run("running"), stageRuns: [stage("a", "source", "succeeded")], pending: [], lastSeq: 2 })
  state = foldRun(state, { _tag: "Event", seq: 3, event: { _tag: "StageStarted", stageRun: stage("b", "transcribe", "running") } })
  state = foldRun(state, { _tag: "Progress", stage: "transcribe", pct: 40, message: "transcribing with grok" })
  state = foldRun(state, { _tag: "Progress", stage: "transcribe", pct: 60, message: null })
  assert.deepEqual(state.live.transcribe, { pct: 60, message: "transcribing with grok" }, "a message is kept until a new one")
  state = foldRun(state, { _tag: "Event", seq: 4, event: { _tag: "StageFinished", stageRun: stage("b", "transcribe", "succeeded") } })
  assert.equal(state.live.transcribe, undefined, "a finished stage has no live progress")
  assert.deepEqual(state.stages.map((s) => `${s.stage}:${s.status}`), ["source:succeeded", "transcribe:succeeded"])
  state = foldRun(state, { _tag: "Event", seq: 5, event: { _tag: "RequestRaised", request: request("q") } })
  assert.equal(state.pending.length, 1)
  state = foldRun(state, { _tag: "Event", seq: 6, event: { _tag: "RequestAnswered", request: request("q") } })
  state = foldRun(state, { _tag: "Event", seq: 7, event: { _tag: "RunFinished", run: run("completed") } })
  assert.equal(state.pending.length, 0)
  assert.equal(isActive(state.run), false)
})

test("each stage shows its latest attempt", () => {
  const latest = latestAttempts([stage("1", "script", "failed", 1), stage("2", "voice", "succeeded"), stage("3", "script", "succeeded", 2)])
  assert.deepEqual(latest.map((s) => `${s.stage}:${s.status}`), ["script:succeeded", "voice:succeeded"])
})
