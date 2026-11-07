// Live check against your Codex CLI (its smallest model, on your ChatGPT plan): one helper tool call over the MCP
// endpoint, the output tool, the interrupted turn and its tokens. Skipped when Codex isn't installed or signed in.
// Run with `bun run test:live`.
import { NodeServices } from "@effect/platform-node"
import { runLiveTask, SECRET } from "@viral/provider-testing"
import { Effect, Layer, Option } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { test } from "node:test"
import { makeCodexProvider } from "./codex-provider.ts"
import { codexStatus } from "./codex-status.ts"

const services = Layer.mergeAll(NodeServices.layer, SecureRandom.layerWebCrypto)
const status = await Effect.runPromise(codexStatus().pipe(Effect.provide(services)))
const skip = Option.isNone(status.version)
  ? "Codex isn't installed"
  : Option.isNone(status.account)
  ? "Codex isn't signed in: run `codex login`"
  : false
// the small tier when the account has it, else the account's default
const model = status.models.find((entry) => entry.id.includes("luna"))?.id ?? null

test("Codex runs a helper tool, submits the result and reports its tokens", { skip, timeout: 300_000 }, async () => {
  // the provider runs codex in its own empty scratch folder
  const run = await Effect.runPromise(runLiveTask(makeCodexProvider(), model).pipe(Effect.provide(services)))
  console.log(JSON.stringify({ version: Option.getOrNull(status.version), seconds: run.seconds, costs: run.costs }))
  assert.deepEqual(run.result, { answer: SECRET + 5 })
  assert.ok(run.progress.includes("→ secret_number"), "the helper tool reached the model")
  assert.equal(run.sessions.length, 1)
  assert.equal(run.costs.length, 1)
  assert.equal(run.costs[0]!.model, model ?? status.models.find((entry) => entry.isDefault)?.id)
  assert.ok(run.costs[0]!.inputTokens > 0 && run.costs[0]!.outputTokens > 0)
  assert.equal(run.costs[0]!.costUsd, 0, "Codex reports tokens, not dollars")
})
