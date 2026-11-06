import { Effect, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AppSettingsStore } from "./app-settings.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-app-settings-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

test("every agent stage starts on the Claude CLI, and can be switched to the gateway and back", async () => {
  const rt = ManagedRuntime.make(AppSettingsStore.layer)
  const [fresh, onGateway, back] = await rt.runPromise(Effect.gen(function*() {
    const store = yield* AppSettingsStore
    const fresh = yield* store.get
    const onGateway = yield* store.setStageProvider("story", "ai-gateway", "openai/gpt-6-luna")
    const back = yield* store.setStageProvider("story", "claude-cli", null)
    return [fresh, onGateway, back] as const
  }))
  assert.deepEqual(Object.keys(fresh.stageProviders).sort(), ["ads", "metadata", "script", "sections", "shots", "story", "thumbnail"])
  assert.ok(Object.values(fresh.stageProviders).every((p) => p === "claude-cli"))
  assert.equal(onGateway.stageProviders.story, "ai-gateway")
  assert.equal(onGateway.stageModels.story, "openai/gpt-6-luna")
  assert.equal(onGateway.stageProviders.script, "claude-cli", "other stages are untouched")
  assert.equal(back.stageProviders.story, "claude-cli")
  assert.equal(back.stageModels.story, null, "back to the stage's own default model")
  await rt.dispose()
})
