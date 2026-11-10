import { Effect } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { AgentSession } from "../agent-session/agent-session.ts"
import { type EvalRunResult, parseModel, runEval } from "./eval-runner.ts"
import type { EvalStage } from "./eval-stages.ts"

test("models as typed: provider:model", () => {
  assert.deepEqual(parseModel("claude-cli"), { label: "claude-cli", provider: "claude-cli", model: null })
  assert.deepEqual(parseModel("claude-cli:opus"), { label: "claude-cli:opus", provider: "claude-cli", model: "opus" })
  assert.deepEqual(parseModel("codex"), { label: "codex", provider: "codex", model: null })
  assert.deepEqual(parseModel("codex:gpt-6-astra"), { label: "codex:gpt-6-astra", provider: "codex", model: "gpt-6-astra" })
  assert.deepEqual(parseModel("opencode:anthropic/claude-haiku-5.5"), {
    label: "opencode:anthropic/claude-haiku-5.5",
    provider: "opencode",
    model: "anthropic/claude-haiku-5.5"
  })
  assert.deepEqual(parseModel("gateway:openai/gpt-6-luna"), { label: "openai/gpt-6-luna", provider: "ai-gateway", model: "openai/gpt-6-luna" })
  assert.deepEqual(parseModel("openai/gpt-6-luna"), { label: "openai/gpt-6-luna", provider: "ai-gateway", model: "openai/gpt-6-luna" })
  assert.deepEqual(parseModel("anthropic:claude-haiku-5-5"), { label: "anthropic:claude-haiku-5-5", provider: "anthropic", model: "claude-haiku-5-5" })
  assert.deepEqual(parseModel("openai:gpt-6-luna"), { label: "openai:gpt-6-luna", provider: "openai", model: "gpt-6-luna" })
  assert.deepEqual(parseModel("google:gemini-3.8-flash"), { label: "google:gemini-3.8-flash", provider: "google", model: "gemini-3.8-flash" })
  assert.deepEqual(parseModel("openrouter:anthropic/claude-haiku-5.5"), {
    label: "openrouter:anthropic/claude-haiku-5.5",
    provider: "openrouter",
    model: "anthropic/claude-haiku-5.5"
  })
  assert.equal(parseModel("anthropic:"), null)
  assert.equal(parseModel("openrouter:haiku"), null, "OpenRouter ids are vendor/model")
  assert.equal(parseModel("opencode:haiku"), null)
  assert.equal(parseModel("gpt"), null)
})

// A stage that reports a fixed cost per run, without an agent.
const stage: EvalStage = {
  name: "metadata",
  defaultModel: "haiku",
  run: (_agent, ctx) =>
    ctx.recordCost({ model: "m", inputTokens: 1000, outputTokens: 100, costUsd: 0.4 }).pipe(
      Effect.andThen(Effect.sync(() => ({ ok: true })))
    )
}

test("priced runs stop at the budget, runs on a plan at the per-provider cap", async () => {
  const seen: Array<EvalRunResult> = []
  const { results, spentUsd } = await Effect.runPromise(runEval({
    stages: [stage],
    models: [parseModel("codex")!, parseModel("gateway:openai/gpt-6-luna")!],
    runs: 4,
    budgetUsd: 1,
    billing: (provider) => provider === "codex" ? "subscription" : "billed",
    maxSubscriptionRuns: 3,
    onResult: (r) => Effect.sync(() => void seen.push(r))
  }).pipe(Effect.provide(AgentSession.replay(() => null))))

  const status = (model: string) => results.filter((r) => r.model === model).map((r) => r.status)
  // a plan's runs don't count toward the dollars
  assert.deepEqual(status("codex"), ["passed", "passed", "passed", "skipped"])
  assert.deepEqual(status("openai/gpt-6-luna"), ["passed", "passed", "skipped", "skipped"])
  assert.equal(spentUsd, 0.8)
  assert.match(results.find((r) => r.model === "codex" && r.status === "skipped")!.error!, /3 runs allowed on the codex plan/)
  assert.equal(results[0]!.billing, "subscription")
  assert.equal(seen.length, 8)
})

test("a priced run on a model with no known price still counts toward the budget, at the cautious guess", async () => {
  const unpriced: EvalStage = {
    name: "metadata",
    defaultModel: "haiku",
    run: (_agent, ctx) =>
      ctx.recordCost({ model: "gemini-0", inputTokens: 1000, outputTokens: 100, costUsd: null, costBasis: "unknown" }).pipe(
        Effect.andThen(Effect.sync(() => ({ ok: true })))
      )
  }
  const { results, spentUsd } = await Effect.runPromise(runEval({
    stages: [unpriced],
    models: [parseModel("google:gemini-0")!],
    runs: 3,
    budgetUsd: 0.07,
    billing: () => "billed",
    maxSubscriptionRuns: 3,
    onResult: () => Effect.void
  }).pipe(Effect.provide(AgentSession.replay(() => null))))
  // metadata's cautious guess for an API model is $0.03: two runs fit in $0.07, the third would pass it
  assert.deepEqual(results.map((r) => [r.status, r.costBasis, r.costUsd]), [["passed", "unknown", 0], ["passed", "unknown", 0], ["skipped", null, 0]])
  assert.equal(spentUsd, 0.06)
})
