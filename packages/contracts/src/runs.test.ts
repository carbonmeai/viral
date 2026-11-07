import { Schema } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { StageRun } from "./runs.ts"

const stored = {
  id: "sr-1",
  runId: "run-1",
  stage: "script",
  attempt: 1,
  status: "succeeded",
  model: "claude-haiku-4-5",
  error: null,
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.01,
  durationMs: 1200,
  startedAt: "2026-11-01T10:00:00.000Z",
  finishedAt: "2026-11-01T10:00:01.200Z"
}

test("a stage run stored before provider, billing and TTS characters existed still reads, as null", () => {
  const run = Schema.decodeUnknownSync(StageRun)(stored)
  assert.equal(run.provider, null)
  assert.equal(run.billing, null)
  assert.equal(run.ttsCharacters, null)
})

test("a stage run with them keeps them", () => {
  const run = Schema.decodeUnknownSync(StageRun)({ ...stored, provider: "codex", billing: "subscription", ttsCharacters: 42 })
  assert.deepEqual([run.provider, run.billing, run.ttsCharacters], ["codex", "subscription", 42])
})
