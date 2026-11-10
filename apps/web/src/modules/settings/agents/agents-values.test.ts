import type { ModelEval } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { badgesFor, evalKey, evalLabel, evalLine, keyModelOptions, modelLabel } from "./agents-values.ts"

const luna: ModelEval = {
  model: "openai/gpt-6-luna",
  provider: "ai-gateway",
  runs: 8,
  passed: 8,
  firstTryPassed: 7,
  avgCostUsd: 0.0019,
  costBasis: "reported",
  stages: ["ads", "metadata", "script", "story"],
  lastRunAt: "2026-11-06T20:00:00.000Z"
}
const cli: ModelEval = { ...luna, model: "claude-cli", provider: "claude-cli", avgCostUsd: 0.126 }

test("models read as people say them", () => {
  assert.equal(modelLabel("claude-cli", null), "CLI default")
  assert.equal(modelLabel("claude-cli", "opus"), "Opus")
  assert.equal(modelLabel("ai-gateway", "anthropic/claude-haiku-5.5"), "Claude Haiku 5.5")
  assert.equal(modelLabel("anthropic", "claude-sonnet-5-5"), "Claude Sonnet 5.5")
  assert.equal(modelLabel("openrouter", "z/new", [], [{ provider: "openrouter", models: [{ id: "z/new", label: "Z: New", vision: false }], problem: null, fetchedAt: null }]), "Z: New")
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

test("Codex and OpenCode names, eval keys and lines", () => {
  const catalog = [{ provider: "codex" as const, models: [{ id: "gpt-6-astra", label: "GPT-6-Astra" }] }]
  assert.equal(modelLabel("codex", null), "Codex default")
  assert.equal(modelLabel("codex", "gpt-6-astra", catalog), "GPT-6-Astra")
  assert.equal(modelLabel("opencode", "anthropic/claude-haiku-5.5"), "anthropic/claude-haiku-5.5")
  assert.equal(evalKey({ provider: "codex", model: null }), "codex")
  assert.equal(evalKey({ provider: "codex", model: "gpt-6-astra" }), "codex:gpt-6-astra")
  assert.equal(evalKey({ provider: "opencode", model: "zen/big" }), "opencode:zen/big")
  const codex: ModelEval = { ...luna, model: "codex", provider: "codex", avgCostUsd: 0 }
  assert.equal(evalLabel(codex), "Codex (its default model)")
  assert.equal(evalLabel({ ...codex, model: "codex:gpt-6-astra" }), "Codex · gpt-6-astra")
  assert.equal(evalLine([codex], { provider: "codex", model: null }), "Evals: 8/8 passed · 7/8 first try · on your plan")
})

test("direct keys: eval keys and labels, estimated costs and unknown prices", () => {
  assert.equal(evalKey({ provider: "anthropic", model: "claude-haiku-5-5" }), "anthropic:claude-haiku-5-5")
  assert.equal(evalKey({ provider: "openrouter", model: "openai/gpt-6-luna" }), "openrouter:openai/gpt-6-luna")
  const haiku: ModelEval = { ...luna, model: "anthropic:claude-haiku-5-5", provider: "anthropic", avgCostUsd: 0.0021, costBasis: "estimate" }
  assert.equal(evalLabel(haiku), "Anthropic · Claude Haiku 5.5")
  assert.equal(evalLine([haiku], { provider: "anthropic", model: "claude-haiku-5-5" }), "Evals: 8/8 passed · 7/8 first try · $0.0021 a run (estimate)")
  const unpriced: ModelEval = { ...haiku, model: "google:gemini-0", provider: "google", avgCostUsd: 0, costBasis: "unknown" }
  assert.equal(evalLine([unpriced], { provider: "google", model: "gemini-0" }), "Evals: 8/8 passed · 7/8 first try · price unknown")
})

test("the model picker: curated models first with badges and cost, then the rest of your key's list", () => {
  assert.deepEqual(badgesFor("anthropic", "claude-haiku-5-5", "ads"), ["Recommended", "Sees images", "Fast", "Cheapest"])
  assert.deepEqual(badgesFor("anthropic", "claude-sonnet-5-5", "script"), ["Recommended", "Sees images"])
  assert.deepEqual(badgesFor("anthropic", "claude-sonnet-5-5", null), ["Recommended", "Sees images"], "a good default for every step")
  assert.deepEqual(badgesFor("anthropic", "claude-opus-5-5", "ads"), ["Sees images"])

  const live = {
    provider: "anthropic" as const,
    models: [{ id: "claude-haiku-5-5", label: "Claude Haiku 5.5", vision: true }, { id: "claude-fable-5-2", label: "Claude Fable 5.2", vision: true }],
    problem: null,
    fetchedAt: "2026-11-10T00:00:00.000Z"
  }
  const haikuEval: ModelEval = { ...luna, model: "anthropic:claude-haiku-5-5", provider: "anthropic", avgCostUsd: 0.0021, costBasis: "estimate" }
  const options = keyModelOptions("anthropic", "ads", live, [haikuEval], null)
  assert.deepEqual(options.map((o) => [o.value, o.group]), [
    ["claude-haiku-5-5", "Suggested"],
    ["claude-sonnet-5-5", "Suggested"],
    ["claude-opus-5-5", "Suggested"],
    ["claude-fable-5-2", "More from your key"]
  ])
  assert.equal(options[0]!.description, "Fast and cheap, good for ads, research and titles · Recommended · Sees images · Fast · Cheapest")
  assert.equal(options[0]!.note, "$0.0021 a run (estimate)", "an evaluated model shows what a run cost")
  assert.equal(options[1]!.note, "$2 / $10 per M", "otherwise its price per million tokens")
  assert.doesNotMatch(JSON.stringify(options), /Trending/)
  // a model you typed that no list has still shows
  assert.equal(keyModelOptions("anthropic", "ads", live, [], "claude-x").at(-1)!.value, "claude-x")
})
