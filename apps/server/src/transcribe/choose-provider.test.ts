import { Effect, Exit } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { chooseProvider, type ProviderInputs } from "./transcriber.ts"

const base: ProviderInputs = { environment: null, setting: "auto", hasXaiKey: true, appleSilicon: true, prefer: undefined }
const pick = (over: Partial<ProviderInputs>) => Effect.runSync(Effect.exit(chooseProvider({ ...base, ...over })))
const value = (over: Partial<ProviderInputs>) => {
  const exit = pick(over)
  return Exit.isSuccess(exit) ? exit.value : `failed`
}

test("the environment wins, then your setting, then the stage's preference, then the automatic order", () => {
  assert.equal(value({ environment: "whisper-local", setting: "grok" }), "whisper-local")
  assert.equal(value({ setting: "whisper-local", prefer: "grok" }), "whisper-local", "an explicit setting beats a stage's preference")
  assert.equal(value({ prefer: "whisper-local" }), "whisper-local")
  assert.equal(value({}), "grok", "automatic: Grok with an xAI key")
  assert.equal(value({ hasXaiKey: false }), "whisper-local", "automatic: Whisper on Apple Silicon without one")
  assert.equal(value({ hasXaiKey: false, appleSilicon: false }), "failed")
  assert.equal(value({ environment: "bogus" }), "failed")
})
