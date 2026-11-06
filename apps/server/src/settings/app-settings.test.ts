import { resolveAgentRoute } from "@viral/contracts"
import { Effect, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AppSettingsStore, checkChoice } from "./app-settings.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-app-settings-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

test("every step starts on the Claude CLI; a gateway default moves the text steps but not the vision ones", async () => {
  const rt = ManagedRuntime.make(AppSettingsStore.layer)
  const [fresh, gatewayDefault, ownStory, backToDefault, noModel, visionOnGateway] = await rt.runPromise(Effect.gen(function*() {
    const store = yield* AppSettingsStore
    const fresh = yield* store.get
    const gatewayDefault = yield* store.setDefaultAgent({ provider: "ai-gateway", model: "anthropic/claude-haiku-5.5" })
    const ownStory = yield* store.setStageAgent("story", { provider: "claude-cli", model: "opus" })
    const backToDefault = yield* store.setStageAgent("story", null)
    const noModel = yield* Effect.flip(store.setDefaultAgent({ provider: "ai-gateway", model: " " }))
    const visionOnGateway = yield* Effect.flip(store.setStageAgent("shots", { provider: "ai-gateway", model: "openai/gpt-6-luna" }))
    return [fresh, gatewayDefault, ownStory, backToDefault, noModel, visionOnGateway] as const
  }))

  assert.deepEqual(fresh.defaultAgent, { provider: "claude-cli", model: null })
  assert.ok(Object.values(fresh.stageAgents).every((a) => a === null), "no step has its own choice")
  assert.ok(Object.values(fresh.routes).every((r) => r.provider === "claude-cli" && r.inherited))

  assert.deepEqual(gatewayDefault.routes.script, { provider: "ai-gateway", model: "anthropic/claude-haiku-5.5", inherited: true, forcedCli: false })
  assert.deepEqual(gatewayDefault.routes.shots, { provider: "claude-cli", model: null, inherited: true, forcedCli: true }, "vision stays on the CLI")

  assert.deepEqual(ownStory.stageAgents.story, { provider: "claude-cli", model: "opus" })
  assert.deepEqual(ownStory.routes.story, { provider: "claude-cli", model: "opus", inherited: false, forcedCli: false })
  assert.equal(ownStory.routes.ads.provider, "ai-gateway", "other steps keep the default")

  assert.equal(backToDefault.stageAgents.story, null)
  assert.equal(backToDefault.routes.story.provider, "ai-gateway")

  assert.match(noModel.message, /choose a model for the AI Gateway/)
  assert.match(visionOnGateway.message, /looks at images/)
  await rt.dispose()
})

test("the route rule: own choice, then the default, with vision steps kept on the CLI", () => {
  const gateway = { provider: "ai-gateway" as const, model: "openai/gpt-6-luna" }
  assert.deepEqual(resolveAgentRoute("metadata", gateway, null), { provider: "ai-gateway", model: "openai/gpt-6-luna", inherited: true, forcedCli: false })
  assert.deepEqual(resolveAgentRoute("thumbnail", gateway, null), { provider: "claude-cli", model: null, inherited: true, forcedCli: true })
  assert.deepEqual(resolveAgentRoute("thumbnail", gateway, { provider: "claude-cli", model: "sonnet" }), {
    provider: "claude-cli",
    model: "sonnet",
    inherited: false,
    forcedCli: false
  })
  // Codex and OpenCode run the text steps; a vision step chosen for them falls back to the Claude CLI
  const codex = { provider: "codex" as const, model: null }
  assert.deepEqual(resolveAgentRoute("story", codex, null), { provider: "codex", model: null, inherited: true, forcedCli: false })
  assert.deepEqual(resolveAgentRoute("shots", codex, codex), { provider: "claude-cli", model: null, inherited: false, forcedCli: true })
})

test("an OpenCode choice needs a provider/model id", async () => {
  const bad = await Effect.runPromise(Effect.flip(checkChoice("story", { provider: "opencode", model: "haiku" })))
  assert.match(bad.message, /provider\/model/)
  const ok = await Effect.runPromise(checkChoice("story", { provider: "opencode", model: " anthropic/claude-haiku-5.5 " }))
  assert.deepEqual(ok, { provider: "opencode", model: "anthropic/claude-haiku-5.5" })
})
