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

test("every step starts on the Claude CLI; a gateway default on a model that sees images moves every step", async () => {
  const rt = ManagedRuntime.make(AppSettingsStore.layer)
  const [fresh, gatewayDefault, ownStory, backToDefault, noModel, visionOnGateway, blindModel, remembered] = await rt.runPromise(Effect.gen(function*() {
    const store = yield* AppSettingsStore
    const fresh = yield* store.get
    const gatewayDefault = yield* store.setDefaultAgent({ provider: "ai-gateway", model: "anthropic/claude-haiku-5.5" })
    const ownStory = yield* store.setStageAgent("story", { provider: "claude-cli", model: "opus" })
    const backToDefault = yield* store.setStageAgent("story", null)
    const noModel = yield* Effect.flip(store.setDefaultAgent({ provider: "ai-gateway", model: " " }))
    const visionOnGateway = yield* store.setStageAgent("shots", { provider: "ai-gateway", model: "openai/gpt-6-luna" })
    // a model Viral doesn't know to take images can't take an image step, until its vendor's list says it does
    const blindModel = yield* Effect.flip(store.setStageAgent("thumbnail", { provider: "openrouter", model: "qwen/qwen3-vl" }))
    yield* store.rememberVision("openrouter", "qwen/qwen3-vl")
    const remembered = yield* store.setStageAgent("thumbnail", { provider: "openrouter", model: "qwen/qwen3-vl" })
    return [fresh, gatewayDefault, ownStory, backToDefault, noModel, visionOnGateway, blindModel, remembered] as const
  }))

  assert.deepEqual(fresh.defaultAgent, { provider: "claude-cli", model: null })
  assert.ok(Object.values(fresh.stageAgents).every((a) => a === null), "no step has its own choice")
  assert.ok(Object.values(fresh.routes).every((r) => r.provider === "claude-cli" && r.inherited))

  assert.deepEqual(gatewayDefault.routes.script, { provider: "ai-gateway", model: "anthropic/claude-haiku-5.5", inherited: true, forcedCli: false })
  assert.deepEqual(gatewayDefault.routes.shots, { provider: "ai-gateway", model: "anthropic/claude-haiku-5.5", inherited: true, forcedCli: false }, "Haiku sees images")

  assert.deepEqual(ownStory.stageAgents.story, { provider: "claude-cli", model: "opus" })
  assert.deepEqual(ownStory.routes.story, { provider: "claude-cli", model: "opus", inherited: false, forcedCli: false })
  assert.equal(ownStory.routes.ads.provider, "ai-gateway", "other steps keep the default")

  assert.equal(backToDefault.stageAgents.story, null)
  assert.equal(backToDefault.routes.story.provider, "ai-gateway")

  assert.match(noModel.message, /choose a model for the AI Gateway/)
  assert.deepEqual(visionOnGateway.routes.shots, { provider: "ai-gateway", model: "openai/gpt-6-luna", inherited: false, forcedCli: false })
  assert.match(blindModel.message, /the thumbnail step looks at images, and qwen\/qwen3-vl doesn't take images \(or OpenRouter doesn't say it does\)/)
  assert.deepEqual(remembered.visionModels, ["openrouter:qwen/qwen3-vl"])
  assert.equal(remembered.routes.thumbnail.provider, "openrouter")
  await rt.dispose()
})

test("the route rule: own choice, then the default, with vision steps on the CLI unless the model sees images", () => {
  const gateway = { provider: "ai-gateway" as const, model: "openai/gpt-6-luna" }
  assert.deepEqual(resolveAgentRoute("metadata", gateway, null), { provider: "ai-gateway", model: "openai/gpt-6-luna", inherited: true, forcedCli: false })
  assert.deepEqual(resolveAgentRoute("thumbnail", gateway, null), { provider: "ai-gateway", model: "openai/gpt-6-luna", inherited: true, forcedCli: false })
  const blind = { provider: "ai-gateway" as const, model: "deepseek/deepseek-v4" }
  assert.deepEqual(resolveAgentRoute("thumbnail", blind, null), { provider: "claude-cli", model: null, inherited: true, forcedCli: true })
  assert.deepEqual(resolveAgentRoute("thumbnail", blind, null, ["ai-gateway:deepseek/deepseek-v4"]).provider, "ai-gateway", "remembered from the vendor's list")
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

test("a direct key provider runs any step with its own model ids and needs a model; image steps need one that sees images", async () => {
  const noModel = await Effect.runPromiseExit(checkChoice("script", { provider: "anthropic", model: null }))
  assert.match(JSON.stringify(noModel), /choose a model for Anthropic, e\.g\. claude-haiku-5-5/)
  const ok = await Effect.runPromise(checkChoice("script", { provider: "openrouter", model: " anthropic/claude-haiku-5.5 " }))
  assert.deepEqual(ok, { provider: "openrouter", model: "anthropic/claude-haiku-5.5" })
  const vision = await Effect.runPromise(checkChoice("thumbnail", { provider: "google", model: "gemini-3.8-flash" }))
  assert.deepEqual(vision, { provider: "google", model: "gemini-3.8-flash" })
  // a family Viral knows takes images, outside the catalog
  assert.deepEqual(await Effect.runPromise(checkChoice("shots", { provider: "anthropic", model: "claude-sonnet-5" })), { provider: "anthropic", model: "claude-sonnet-5" })
  const blind = await Effect.runPromiseExit(checkChoice("shots", { provider: "openai", model: "gpt-3.5-turbo" }))
  assert.match(JSON.stringify(blind), /gpt-3\.5-turbo doesn't take images/)
  const codex = await Effect.runPromiseExit(checkChoice("shots", { provider: "codex", model: null }))
  assert.match(JSON.stringify(codex), /which Codex can't do in Viral/)
  assert.deepEqual(
    resolveAgentRoute("shots", { provider: "openai", model: "gpt-6-luna" }, null),
    { provider: "openai", model: "gpt-6-luna", inherited: true, forcedCli: false },
    "a direct-key default on a model that sees images runs the image steps too"
  )
  assert.deepEqual(
    resolveAgentRoute("ads", { provider: "openai", model: "gpt-6-luna" }, null),
    { provider: "openai", model: "gpt-6-luna", inherited: true, forcedCli: false }
  )
})
