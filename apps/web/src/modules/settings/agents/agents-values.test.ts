import type { ModelEval } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { badgesFor, cliModelChoices, evalKey, evalLabel, evalLine, keyModelOptions, modelLabel, providerChoices } from "./agents-values.ts"

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
  assert.equal(options[0]!.description, "Fast and cheap, good for ads, research and titles")
  assert.deepEqual(options[0]!.badges, ["Recommended", "Sees images", "Fast", "Cheapest"])
  assert.deepEqual([options[3]!.description, options[3]!.badges], ["claude-fable-5-2", ["Sees images"]], "a model from your key's list: its id and what it can do")
  assert.equal(options[0]!.note, "$0.0021 a run (estimate)", "an evaluated model shows what a run cost")
  assert.equal(options[1]!.note, "$2 / $10 per M", "otherwise its price per million tokens")
  assert.doesNotMatch(JSON.stringify(options), /Trending/)
  // a model you typed that no list has still shows
  assert.equal(keyModelOptions("anthropic", "ads", live, [], "claude-x").at(-1)!.value, "claude-x")
})

test("on an image step, models that don't take images are greyed out with why; others and text steps aren't", () => {
  const live = {
    provider: "openrouter" as const,
    models: [
      { id: "qwen/qwen3-vl", label: "Qwen3 VL", vision: true },
      { id: "deepseek/deepseek-v4", label: "DeepSeek V4", vision: false },
      { id: "z/remembered", label: "Z", vision: null }
    ],
    problem: null,
    fetchedAt: null
  }
  const options = keyModelOptions("openrouter", "thumbnail", live, [], null, ["openrouter:z/remembered"])
  const of = (id: string) => options.find((o) => o.value === id)!
  assert.equal(of("anthropic/claude-haiku-5.5").disabled, undefined, "the catalog's Haiku sees images")
  assert.equal(of("qwen/qwen3-vl").disabled, undefined, "the vendor's list says it sees images")
  assert.equal(of("z/remembered").disabled, undefined, "remembered from the vendor's list")
  assert.deepEqual({ disabled: of("deepseek/deepseek-v4").disabled, note: of("deepseek/deepseek-v4").note }, { disabled: true, note: "Doesn’t take images" })
  assert.equal(keyModelOptions("openrouter", "thumbnail", live, [], "deepseek/deepseek-v4").find((o) => o.value === "deepseek/deepseek-v4")!.disabled, undefined, "the chosen one stays pickable")
  assert.ok(keyModelOptions("openrouter", "script", live, [], null).every((o) => o.disabled === undefined), "text steps take any model")
})

test("the provider picker: your plans, then pay per run, then this Mac; set up or not, and what sees images", () => {
  const ready = { "claude-cli": true, codex: true, opencode: false, anthropic: true, openai: false, google: false, openrouter: false, "ai-gateway": true } as const
  const choices = providerChoices(ready, "ai-gateway", false, [luna], true)
  assert.deepEqual(choices.map((c) => [c.value, c.group]), [
    ["claude-cli", "Your plans"],
    ["codex", "Your plans"],
    ["anthropic", "Pay per run"],
    ["openai", "Pay per run"],
    ["google", "Pay per run"],
    ["openrouter", "Pay per run"],
    ["ai-gateway", "Pay per run"],
    ["opencode", "On this Mac"]
  ])
  const cli = choices[0]!
  assert.deepEqual(cli.badges, ["Recommended", "On your plan"])
  assert.match(cli.description, /no API bill.*Shots, Sections and Thumbnail/)
  assert.deepEqual([choices[3]!.disabled, choices[3]!.note], [true, "Add a key in Accounts"])
  assert.deepEqual([choices[7]!.disabled, choices[7]!.note], [true, "Set up in Accounts"])
  assert.equal(choices[6]!.disabled, false, "the chosen one")
  assert.doesNotMatch(JSON.stringify(choices), /Trending/)
  // on an image step the apps that can't look at images in Viral are greyed out
  const vision = providerChoices(ready, null, true)
  assert.deepEqual([vision[1]!.disabled, vision[1]!.note], [true, "Can’t look at images in Viral"])
})

test("the Claude CLI's models say what they're good for and run on your plan", () => {
  const models = cliModelChoices("claude-cli", [])
  assert.deepEqual(models.map((m) => m.value), ["default", "opus", "sonnet", "haiku"])
  assert.ok(models.every((m) => m.badges.includes("On your plan")))
  assert.match(models[3]!.description ?? "", /ads, research and titles/)
  const codex = cliModelChoices("codex", [{ provider: "codex", models: [{ id: "gpt-6-luna", label: "GPT-6 Luna" }] }])
  assert.deepEqual(codex.map((m) => m.value), ["default", "gpt-6-luna"])
})
