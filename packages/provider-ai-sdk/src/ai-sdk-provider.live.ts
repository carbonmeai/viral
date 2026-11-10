// Live checks against the real services, one per key provider (a small fast model, well under a cent each): one
// helper tool call, the output tool, the session and the cost. Each is skipped when its key isn't in the environment
// (.env). Run with `bun run test:live`.
import { NodeServices } from "@effect/platform-node"
import type { KeyProvider } from "@viral/contracts"
import { runLiveTask, SECRET } from "@viral/provider-testing"
import { Effect, Layer, Option, Redacted } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { makeAiSdkProvider } from "./ai-sdk-provider.ts"

const CHECKS: ReadonlyArray<{ readonly provider: KeyProvider; readonly variables: ReadonlyArray<string>; readonly model: string; readonly basis: string }> = [
  { provider: "ai-gateway", variables: ["AI_GATEWAY_API_KEY"], model: "openai/gpt-6-luna", basis: "reported" },
  { provider: "anthropic", variables: ["ANTHROPIC_API_KEY"], model: "claude-haiku-5-5", basis: "estimate" },
  { provider: "openai", variables: ["OPENAI_API_KEY"], model: "gpt-6-luna", basis: "estimate" },
  { provider: "google", variables: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"], model: "gemini-3.5-flash-lite", basis: "estimate" },
  { provider: "openrouter", variables: ["OPENROUTER_API_KEY"], model: "openai/gpt-6-luna", basis: "reported" }
]

for (const check of CHECKS) {
  const key = check.variables.map((name) => process.env[name]?.trim() ?? "").find((value) => value !== "")
  const skip = key === undefined ? `no ${check.variables.join(" or ")} in the environment` : false
  test(`${check.provider} runs a helper tool, submits the result and records its cost`, { skip, timeout: 120_000 }, async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), `viral-live-${check.provider}-`))
    try {
      const provider = makeAiSdkProvider({ provider: check.provider, apiKey: Effect.succeed(Option.fromNullishOr(key).pipe(Option.map(Redacted.make))), sessionsDir })
      const run = await Effect.runPromise(
        runLiveTask(provider, check.model).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, SecureRandom.layerWebCrypto)))
      )
      console.log(JSON.stringify({ provider: check.provider, seconds: run.seconds, costs: run.costs }))
      assert.deepEqual(run.result, { answer: SECRET + 5 })
      assert.ok(run.progress.includes("→ secret_number"), "the helper tool reached the model")
      assert.equal(run.sessions.length, 1)
      assert.equal(run.costs.length, 1)
      assert.equal(run.costs[0]!.model, check.model)
      assert.ok(run.costs[0]!.inputTokens > 0 && run.costs[0]!.outputTokens > 0)
      assert.equal(run.costs[0]!.costBasis, check.basis)
      assert.ok((run.costs[0]!.costUsd ?? 0) > 0, "a priced run costs something")
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  })
}
