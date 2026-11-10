import { NodeServices } from "@effect/platform-node"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Option, Redacted, Schema } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { ViralHome } from "../home/viral-home.ts"
import { Secrets } from "../secrets/secrets.ts"
import { writeFakeSecurity } from "../secrets/testing/fake-security.ts"
import { Settings } from "../settings/settings.ts"
import { CliSetups, envKey, secretAccount } from "./cli-setup.ts"

const withSetups = async <E>(env: Record<string, string>, use: (dir: string) => Effect.Effect<void, E, CliSetups | Secrets | Settings>) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-cli-setup-")))
  const base = Layer.mergeAll(NodeServices.layer, Settings.layer, Secrets.layerWith({ security: writeFakeSecurity(dir) }), ViralHome.layer)
  const layer = Layer.effect(CliSetups, CliSetups.make).pipe(
    Layer.provideMerge(base),
    Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown({ VIRAL_HOME: join(dir, "home"), ...env })))
  )
  const rt = ManagedRuntime.make(layer)
  try {
    await rt.runPromise(use(dir))
  } finally {
    await rt.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
}

const failure = <A, E extends { readonly message: string }, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.flip(effect), (error) => error.message)

test("dangerous names are refused with a plain reason", async () => {
  await withSetups({}, () =>
    Effect.gen(function*() {
      const setups = yield* CliSetups
      for (const name of ["PATH", "HOME", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "DYLD_INSERT_LIBRARIES", "LD_PRELOAD", "VIRAL_HOME", "OPENCODE_CONFIG_CONTENT", "CODEX_HOME", "path"]) {
        assert.match(yield* failure(setups.setVar("claude", name, "x", false)), /can't be set here/, name)
      }
      assert.match(yield* failure(setups.setVar("claude", "1BAD", "x", false)), /letters, digits and underscores/)
      assert.match(yield* failure(setups.setVar("claude", "MY VAR", "x", false)), /letters, digits and underscores/)
      assert.deepEqual((yield* setups.get("claude")).env, [])
    }))
})

test("a secret value goes to the Keychain, never into settings, and only its last four come back", async () => {
  await withSetups({}, (dir) =>
    Effect.gen(function*() {
      const setups = yield* CliSetups
      const settings = yield* Settings
      const secrets = yield* Secrets
      const setup = yield* setups.setVar("codex", "MY_TOKEN", "test-token-abcd1234", true)
      assert.deepEqual(setup.env, [{ name: "MY_TOKEN", value: null, secret: true, last4: "1234" }])
      assert.ok(!JSON.stringify(setup).includes("test-token-abcd1234"))
      const stored = yield* settings.get(envKey("codex"), Schema.Unknown)
      assert.deepEqual(Option.getOrNull(stored), [{ name: "MY_TOKEN", value: null, secret: true }])
      assert.equal(Option.map(yield* secrets.readStored(secretAccount("codex", "MY_TOKEN")), Redacted.value).pipe(Option.getOrNull), "test-token-abcd1234")
      assert.doesNotMatch(readFileSync(join(dir, "argv.log"), "utf8"), /test-token-abcd1234/, "never on a command line")
      // a run reads it
      assert.deepEqual((yield* setups.resolve("codex")).environment.env, { MY_TOKEN: "test-token-abcd1234" })

      // turned plain, its stored value goes; removed, it's gone everywhere
      yield* setups.setVar("codex", "MY_TOKEN", "plain", false)
      assert.ok(!existsSync(join(dir, "item-cli.codex.env.MY_TOKEN")))
      yield* setups.setVar("codex", "OTHER", "test-secret-zzzz9999", true)
      yield* setups.removeVar("codex", "OTHER")
      assert.ok(!existsSync(join(dir, "item-cli.codex.env.OTHER")))
      assert.deepEqual((yield* setups.get("codex")).env, [{ name: "MY_TOKEN", value: "plain", secret: false, last4: null }])
    }))
})

test("a preset says what it uses and what's missing; a preset of another CLI is refused", async () => {
  await withSetups({}, () =>
    Effect.gen(function*() {
      const setups = yield* CliSetups
      const secrets = yield* Secrets
      const missing = yield* setups.setPreset("claude", "claude-openrouter")
      assert.match(missing.problem ?? "", /Add your OpenRouter key/)
      yield* secrets.set("openrouter", Redacted.make("test-openrouter-key-a1F9"))
      const ready = yield* setups.get("claude")
      assert.equal(ready.problem, null)
      assert.deepEqual(ready.presetVars.find((v) => v.name === "ANTHROPIC_AUTH_TOKEN"), { name: "ANTHROPIC_AUTH_TOKEN", value: "your OpenRouter key …a1F9" })
      assert.match(yield* failure(setups.setPreset("claude", "codex-openai")), /isn't a setup for The Claude CLI/)
      const back = yield* setups.setPreset("claude", null)
      assert.equal(back.preset, null)
      assert.equal(back.billing, "subscription")
    }))
})

test("the Claude CLI counts as billed when the server itself has an Anthropic key, unless a run empties it", async () => {
  await withSetups({ ANTHROPIC_API_KEY: "test-server-key-0001" }, () =>
    Effect.gen(function*() {
      const setups = yield* CliSetups
      assert.equal((yield* setups.resolve("claude-cli")).billing, "billed")
      yield* setups.setVar("claude", "ANTHROPIC_API_KEY", "", false)
      assert.equal((yield* setups.resolve("claude-cli")).billing, "subscription")
      assert.equal((yield* setups.get("claude")).billing, "subscription")
    }))
})
