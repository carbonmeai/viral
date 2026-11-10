import { Effect, Layer } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { databaseAt } from "../persistence/database.ts"
import { evalBilling, EvalRecords } from "./eval-records.ts"
import type { EvalRunResult } from "./eval-runner.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-eval-records-"))
})
after(() => rmSync(home, { recursive: true, force: true }))

const run = (overrides: Partial<EvalRunResult>): EvalRunResult => ({
  stage: "ads",
  model: "openai/gpt-6-luna",
  provider: "ai-gateway",
  billing: "billed",
  run: 1,
  status: "passed",
  error: null,
  costUsd: 0.01,
  costBasis: "reported",
  inputTokens: 100,
  outputTokens: 20,
  seconds: 2,
  reportedModel: "openai/gpt-6-luna",
  firstTryPass: true,
  firstTryProblems: [],
  fixRounds: 0,
  result: null,
  ...overrides
})

test("eval runs are recorded in a library's database, once per run, and summed up per model", async () => {
  const layer = EvalRecords.layer.pipe(Layer.provide(databaseAt(join(home, "viral.db"))))
  const models = await Effect.runPromise(Effect.gen(function*() {
    const records = yield* EvalRecords
    yield* records.record("e1", run({}), "billed", "2026-11-06T10:00:00Z")
    yield* records.record("e1", run({ stage: "story", costUsd: 0.03, firstTryPass: false, fixRounds: 1 }), "billed", "2026-11-06T10:00:00Z")
    // the same run recorded again replaces it rather than counting twice
    yield* records.record("e1", run({ stage: "story", costUsd: 0.03, firstTryPass: false, fixRounds: 1 }), "billed", "2026-11-06T10:00:00Z")
    yield* records.record("e1", run({ run: 2, status: "skipped", costUsd: 0 }), "billed", "2026-11-06T10:00:00Z")
    yield* records.record("e1", run({ model: "claude-cli", provider: "claude-cli", status: "failed", firstTryPass: false, costUsd: 0.4, costBasis: null }), "subscription", "2026-11-06T10:01:00Z")
    // a direct key: estimated from tokens, and one run on a model with no price
    yield* records.record("e1", run({ model: "anthropic:claude-haiku-5-5", provider: "anthropic", costUsd: 0.002, costBasis: "estimate" }), "billed", "2026-11-06T10:02:00Z")
    yield* records.record("e1", run({ model: "google:gemini-0", provider: "google", costUsd: 0, costBasis: "unknown" }), "billed", "2026-11-06T10:03:00Z")
    return yield* records.byModel
  }).pipe(Effect.provide(layer)))

  assert.deepEqual(models, [
    { model: "google:gemini-0", provider: "google", runs: 1, passed: 1, firstTryPassed: 1, avgCostUsd: 0, costBasis: "unknown", stages: ["ads"], lastRunAt: "2026-11-06T10:03:00Z" },
    { model: "anthropic:claude-haiku-5-5", provider: "anthropic", runs: 1, passed: 1, firstTryPassed: 1, avgCostUsd: 0.002, costBasis: "estimate", stages: ["ads"], lastRunAt: "2026-11-06T10:02:00Z" },
    { model: "openai/gpt-6-luna", provider: "ai-gateway", runs: 2, passed: 2, firstTryPassed: 1, avgCostUsd: 0.02, costBasis: "reported", stages: ["ads", "story"], lastRunAt: "2026-11-06T10:00:00Z" },
    { model: "claude-cli", provider: "claude-cli", runs: 1, passed: 0, firstTryPassed: 0, avgCostUsd: 0.4, costBasis: null, stages: ["ads"], lastRunAt: "2026-11-06T10:01:00Z" }
  ])
  assert.equal(evalBilling("claude-cli", false), "subscription")
  assert.equal(evalBilling("claude-cli", true), "billed")
  assert.equal(evalBilling("ai-gateway", false), "billed")
  assert.equal(evalBilling("openrouter", false), "billed")
})
