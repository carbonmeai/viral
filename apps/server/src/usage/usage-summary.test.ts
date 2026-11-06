import assert from "node:assert/strict"
import { test } from "node:test"
import { summarizeUsage, type UsageRow } from "./usage-summary.ts"

const row = (over: Partial<UsageRow>): UsageRow => ({
  stage: "script",
  status: "succeeded",
  model: null,
  costUsd: null,
  ttsCharacters: null,
  inputTokens: null,
  outputTokens: null,
  startedAt: "2026-11-06T10:00:00.000Z",
  projectId: null,
  projectTitle: null,
  ...over
})

const rows: ReadonlyArray<UsageRow> = [
  // a source run (no short)
  row({ stage: "story", model: "claude-opus-5-5", costUsd: 0.43, startedAt: "2026-11-05T09:00:00.000Z" }),
  // short A: script, voice, render
  row({ stage: "script", model: "claude-opus-5-5", costUsd: 0.25, inputTokens: 100, outputTokens: 10, projectId: "a", projectTitle: "Every taste" }),
  row({ stage: "voice", model: "eleven_v4", costUsd: 0, ttsCharacters: 180, projectId: "a", projectTitle: "Every taste" }),
  row({ stage: "render", projectId: "a", projectTitle: "Every taste" }),
  // short B: an expensive shots run but no render yet
  row({ stage: "shots", model: "claude-opus-5-5", costUsd: 1.2, projectId: "b", projectTitle: "What if" }),
  row({ stage: "script", status: "reused", projectId: "b", projectTitle: "What if" }),
  // outside a 7-day period
  row({ stage: "script", costUsd: 9, startedAt: "2026-10-01T10:00:00.000Z", projectId: "a", projectTitle: "Every taste" })
]

test("usage adds up the period: totals, every day, the costliest shorts and each step", () => {
  const usage = summarizeUsage(rows, 7, "2026-11-06")
  assert.deepEqual(usage.totals, { costUsd: 1.88, ttsCharacters: 180, inputTokens: 100, outputTokens: 10, shorts: 1, costPerShortUsd: 0.25 })
  assert.equal(usage.byDay.length, 7)
  assert.deepEqual(usage.byDay.at(0), { day: "2026-10-31", costUsd: 0, ttsCharacters: 0 })
  assert.deepEqual(usage.byDay.slice(-2), [
    { day: "2026-11-05", costUsd: 0.43, ttsCharacters: 0 },
    { day: "2026-11-06", costUsd: 1.45, ttsCharacters: 180 }
  ])
  assert.deepEqual(usage.byShort.map((s) => [s.title, s.costUsd]), [["What if", 1.2], ["Every taste", 0.25]])
  assert.deepEqual(usage.byStage.map((s) => [s.stage, s.model, s.runs, s.costUsd]), [
    ["shots", "claude-opus-5-5", 1, 1.2],
    ["story", "claude-opus-5-5", 1, 0.43],
    ["script", "claude-opus-5-5", 1, 0.25],
    ["voice", "eleven_v4", 1, 0],
    ["render", null, 1, 0]
  ])
})

test("an empty period is all zeros, with no cost per short", () => {
  const usage = summarizeUsage([], 30, "2026-11-06")
  assert.equal(usage.byDay.length, 30)
  assert.equal(usage.totals.costPerShortUsd, null)
  assert.deepEqual(usage.byShort, [])
})
