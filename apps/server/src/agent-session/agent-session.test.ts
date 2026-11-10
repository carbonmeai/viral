import { NodeServices } from "@effect/platform-node"
import { MockLanguageModelV4 } from "ai/test"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { SkillPack } from "../agent-skills/skill-pack.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Secrets } from "../secrets/secrets.ts"
import { writeFakeSecurity } from "../secrets/testing/fake-security.ts"
import { AppSettingsStore } from "../settings/app-settings.ts"
import { Settings } from "../settings/settings.ts"
import { AgentSession, type AgentTask, toolShape } from "./agent-session.ts"

const Answer = Schema.Struct({ answer: Schema.Int, why: Schema.optionalKey(Schema.String) })

const task: AgentTask<typeof Answer> = {
  stage: "test",
  instructions: "Answer.",
  skills: [],
  message: "What is 6 × 7?",
  output: { tool: "propose_answer", description: "Submit the answer.", schema: Answer },
  defaultModel: null
}

const hooks = { progress: () => Effect.void, recordCost: () => Effect.void, recordSession: () => Effect.void }

test("the tool's input schema comes from the Effect Schema", () => {
  const shape = toolShape(Answer)
  assert.deepEqual(Object.keys(shape).sort(), ["answer", "why"])
  assert.equal(shape.answer!.safeParse(42).success, true)
  assert.equal(shape.answer!.safeParse("42").success, false)
  assert.equal(shape.why!.safeParse(undefined).success, true, "optional fields stay optional")
})

test("replay answers through the stage's schema", async () => {
  const ok = await Effect.runPromise(
    AgentSession.use((s) => s.run(task, hooks)).pipe(Effect.provide(AgentSession.replay(() => ({ answer: 42 }))))
  )
  assert.deepEqual(ok, { answer: 42 })

  const bad = await Effect.runPromiseExit(
    AgentSession.use((s) => s.run(task, hooks)).pipe(Effect.provide(AgentSession.replay(() => ({ answer: "lots" }))))
  )
  assert.match(JSON.stringify(bad), /invalid-output/)
})

test("a step set to a direct key provider runs there with that key; its cost is billed and marked an estimate", async () => {

  const dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-agent-session-")))
  const seen: Array<{ readonly provider: string; readonly model: string; readonly key: string }> = []
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "tool-call", toolCallId: "c1", toolName: "propose_answer", input: JSON.stringify({ answer: 42 }) }],
      finishReason: { unified: "tool-calls", raw: undefined },
      usage: { inputTokens: { total: 5000, noCache: 5000, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 200, text: 200, reasoning: undefined } },
      warnings: []
    })
  })
  const config = ConfigProvider.layer(ConfigProvider.fromUnknown({ VIRAL_HOME: join(dir, "home"), OPENAI_API_KEY: "test-openai-key-0001" }))
  const layer = Layer.effect(
    AgentSession,
    AgentSession.make({ keyModel: (provider, modelId, key) => (seen.push({ provider, model: modelId, key }), model) })
  ).pipe(
    Layer.provideMerge(AppSettingsStore.layer),
    Layer.provide([NodeServices.layer, SkillPack.layer, Settings.layer, Secrets.layerWith({ security: writeFakeSecurity(dir) }), ViralHome.layer, SecureRandom.layerWebCrypto]),
    Layer.provideMerge(config)
  )
  const rt = ManagedRuntime.make(layer)
  const costs: Array<unknown> = []
  try {
    const answer = await rt.runPromise(Effect.gen(function*() {
      const store = yield* AppSettingsStore
      yield* store.setStageAgent("metadata", { provider: "openai", model: "gpt-6-luna" })
      const session = yield* AgentSession
      return yield* session.run({ ...task, stage: "metadata" }, { ...hooks, recordCost: (cost) => Effect.sync(() => void costs.push(cost)) })
    }))
    assert.deepEqual(answer, { answer: 42 })
    assert.deepEqual(seen, [{ provider: "openai", model: "gpt-6-luna", key: "test-openai-key-0001" }])
    assert.deepEqual(costs, [{ model: "gpt-6-luna", inputTokens: 5000, outputTokens: 200, costUsd: 0.0006, costBasis: "estimate", provider: "openai", billing: "billed" }])
  } finally {
    await rt.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
