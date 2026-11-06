import type { ModelEval } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { evalKey, evalLabel, evalLine, modelLabel } from "./agents-values.ts"

const luna: ModelEval = {
  model: "openai/gpt-6-luna",
  provider: "ai-gateway",
  runs: 8,
  passed: 8,
  firstTryPassed: 7,
  avgCostUsd: 0.0019,
  stages: ["ads", "metadata", "script", "story"],
  lastRunAt: "2026-11-06T20:00:00.000Z"
}
const cli: ModelEval = { ...luna, model: "claude-cli", provider: "claude-cli", avgCostUsd: 0.126 }

test("models read as people say them", () => {
  assert.equal(modelLabel("claude-cli", null), "CLI default")
  assert.equal(modelLabel("claude-cli", "opus"), "Opus")
  assert.equal(modelLabel("ai-gateway", "anthropic/claude-haiku-5.5"), "Claude Haiku 5.5")
  assert.equal(modelLabel("ai-gateway", "mistral/large"), "mistral/large")
  assert.equal(evalLabel(cli), "Claude CLI (each step’s default)")
  assert.equal(evalLabel({ ...cli, model: "claude-cli:sonnet" }), "Claude CLI · Sonnet")
})

test("a choice finds its eval record", () => {
  assert.equal(evalKey({ provider: "claude-cli", model: null }), "claude-cli")
  assert.equal(evalKey({ provider: "claude-cli", model: "opus" }), "claude-cli:opus")
  assert.equal(evalLine([cli, luna], { provider: "ai-gateway", model: "openai/gpt-6-luna" }), "Evals: 8/8 passed · 7/8 first try · $0.0019 a run")
  assert.equal(evalLine([cli, luna], { provider: "claude-cli", model: null }), "Evals: 8/8 passed · 7/8 first try · $0.126 a run")
  assert.equal(evalLine([cli], { provider: "ai-gateway", model: "anthropic/claude-haiku-5.5" }), null)
})
