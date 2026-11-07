// Live check against your OpenCode, on whatever provider you signed in to there: one helper tool call over the MCP
// endpoint, the output tool, the interrupted session and its cost. The model is VIRAL_OPENCODE_LIVE_MODEL, else a
// cheap fast one when OpenCode lists it (Haiku on the OpenCode Console), else OpenCode's default. Skipped when
// OpenCode isn't installed, is too old or isn't signed in. Run with `bun run test:live`.
import { NodeServices } from "@effect/platform-node"
import { runLiveTask, SECRET } from "@viral/provider-testing"
import { Effect, Layer, Option } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { test } from "node:test"
import { makeOpencodeProvider } from "./opencode-provider.ts"
import { MIN_OPENCODE_VERSION, updateHint } from "./opencode-server.ts"
import { opencodeStatus } from "./opencode-status.ts"

const services = Layer.mergeAll(NodeServices.layer, SecureRandom.layerWebCrypto)
const status = await Effect.runPromise(opencodeStatus().pipe(Effect.provide(services)))
const skip = Option.isNone(status.version)
  ? "OpenCode isn't installed"
  : status.outdated
  ? `OpenCode ${status.version.value} is older than ${MIN_OPENCODE_VERSION}: ${updateHint}`
  : !status.signedIn
  ? "OpenCode isn't signed in to a provider: sign in with `opencode auth login`"
  : false

const CHEAP = ["opencode/claude-haiku-5-5"]
const model = process.env["VIRAL_OPENCODE_LIVE_MODEL"] ?? CHEAP.find((id) => status.models.includes(id)) ?? null

test("OpenCode runs a helper tool, submits the result and reports its cost", { skip, timeout: 300_000 }, async () => {
  // the provider runs `opencode serve` on a free port in its own empty scratch folder
  const run = await Effect.runPromise(runLiveTask(makeOpencodeProvider(), model).pipe(Effect.provide(services)))
  console.log(JSON.stringify({ version: Option.getOrNull(status.version), seconds: run.seconds, costs: run.costs }))
  assert.deepEqual(run.result, { answer: SECRET + 5 })
  assert.ok(run.progress.includes("→ secret_number"), "the helper tool reached the model")
  assert.equal(run.sessions.length, 1)
  assert.equal(run.costs.length, 1)
  assert.match(run.costs[0]!.model ?? "", /^[\w.-]+\/\S+$/, "the model is provider/model")
  // some providers behind OpenCode report no input tokens on a turn (the AI Gateway on Gemini did)
  assert.ok(run.costs[0]!.outputTokens > 0)
  assert.ok(run.costs[0]!.costUsd >= 0)
})
