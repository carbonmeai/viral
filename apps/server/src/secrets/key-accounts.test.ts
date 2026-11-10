import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { KeyAccounts } from "./key-accounts.ts"
import { KeyChecks } from "./key-check.ts"
import { Secrets } from "./secrets.ts"
import { type FakeKeyServices, startFakeKeyServices, UNREACHABLE } from "./testing/fake-key-services.ts"
import { writeFakeSecurity } from "./testing/fake-security.ts"

let dir: string
let home: string
let security: string
let fake: FakeKeyServices
before(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-key-accounts-")))
  home = mkdtempSync(join(tmpdir(), "viral-key-accounts-home-"))
  security = writeFakeSecurity(dir)
  fake = await startFakeKeyServices()
})
after(async () => {
  await fake.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

// Every service at the fake, unless a test moves one; only the environment the test gives (never the real one).
const run = <A, E>(effect: Effect.Effect<A, E, KeyAccounts>, env: Record<string, string> = {}) => {
  const services = Object.fromEntries(
    ["ANTHROPIC_API_URL", "OPENAI_API_URL", "GOOGLE_API_URL", "OPENROUTER_API_URL", "AI_GATEWAY_API_URL", "ELEVENLABS_API_URL", "XAI_API_URL"]
      .map((name) => [name, fake.base])
  )
  const config = ConfigProvider.layer(ConfigProvider.fromUnknown({ VIRAL_HOME: home, ...services, ...env }))
  const layer = Layer.effect(KeyAccounts, KeyAccounts.make).pipe(
    Layer.provide([Secrets.layerWith({ security }), KeyChecks.layer]),
    Layer.provideMerge(config)
  )
  const rt = ManagedRuntime.make(layer)
  return rt.runPromise(effect).finally(() => rt.dispose())
}
const keychainHas = (name: string) => existsSync(join(dir, `item-${name}`))

test("a working key is checked, saved, and shown by its last four characters only", async () => {
  const key = "good-key-sk-ant-api03-SECRETVALUE-a1F9"
  const { saved, account } = await run(Effect.gen(function*() {
    const keys = yield* KeyAccounts
    const saved = yield* keys.save("anthropic", ` ${key} `)
    return { saved, account: yield* keys.account("anthropic") }
  }))
  assert.equal(saved.check.code, "ok")
  assert.equal(saved.check.message, "Works. 3 models available.")
  assert.deepEqual(
    [account.status, account.source, account.envVar, account.last4, account.check?.models],
    ["ready", "keychain", null, "a1F9", 3]
  )
  assert.ok(keychainHas("anthropic"))
  assert.doesNotMatch(JSON.stringify(account), /SECRETVALUE/, "the row never carries the key")
  assert.doesNotMatch(JSON.stringify(saved), /SECRETVALUE/)
  assert.doesNotMatch(readFileSync(join(dir, "argv.log"), "utf8"), /SECRETVALUE/, "never in a command line")
})

test("a refused key is not saved; a malformed one is turned away before any call", async () => {
  const refused = await run(Effect.flip(Effect.flatMap(KeyAccounts, (keys) => keys.save("openai", "bad-key-sk-proj-0123456789"))))
  assert.match(refused.message, /^OpenAI refused this key .* Nothing saved\.$/)
  assert.doesNotMatch(refused.message, /0123456789/)
  assert.equal(keychainHas("openai"), false)
  const asked = fake.requests.length
  const malformed = await run(Effect.flip(Effect.flatMap(KeyAccounts, (keys) => keys.save("openai", "two words"))))
  assert.match(malformed.message, /doesn’t look like an API key/)
  assert.equal(fake.requests.length, asked, "no call for a value that can't be a key")
})

test("an unreachable service saves the key anyway, with a warning; Test later keeps the new result", async () => {
  const saved = await run(Effect.flatMap(KeyAccounts, (keys) => keys.save("openrouter", "good-key-sk-or-v1-77778888")), {
    OPENROUTER_API_URL: UNREACHABLE
  })
  assert.equal(saved.check.code, "unreachable")
  assert.equal(saved.check.message, "Couldn't reach OpenRouter. Saved anyway; test again later.")
  assert.ok(keychainHas("openrouter"))
  const retest = await run(Effect.gen(function*() {
    const keys = yield* KeyAccounts
    const check = yield* keys.test("openrouter", null)
    return { check, account: yield* keys.account("openrouter") }
  }))
  assert.equal(retest.check.code, "ok")
  assert.equal(retest.account.check?.message, "Works. $7.50 left on this key.")
  const removed = await run(Effect.flatMap(KeyAccounts, (keys) => keys.remove("openrouter")))
  assert.deepEqual([removed.status, removed.source, removed.last4, removed.check], ["missing", null, null, null])
  assert.equal(keychainHas("openrouter"), false)
})

test("a pasted key can be tested without saving it", async () => {
  const check = await run(Effect.flatMap(KeyAccounts, (keys) => keys.test("gateway", "good-key-vercel-gateway")))
  assert.equal(check.code, "ok")
  assert.equal(keychainHas("gateway"), false)
  const none = await run(Effect.flip(Effect.flatMap(KeyAccounts, (keys) => keys.test("gateway", null))))
  assert.match(none.message, /no key to test.*AI_GATEWAY_API_KEY/)
})

test("an environment key wins: the row names the variable, saving is refused, and Test checks the variable's key", async () => {
  const env = { GEMINI_API_KEY: "good-key-AIzaFromEnv-wxyz" }
  const { refused, check, account } = await run(Effect.gen(function*() {
    const keys = yield* KeyAccounts
    const refused = yield* Effect.flip(keys.save("google", "good-key-other"))
    const check = yield* keys.test("google", null)
    return { refused, check, account: yield* keys.account("google") }
  }), env)
  assert.match(refused.message, /GEMINI_API_KEY is set in the environment/)
  assert.equal(keychainHas("google"), false)
  assert.equal(check.code, "ok")
  assert.deepEqual([account.source, account.envVar, account.last4, account.check?.code], ["environment", "GEMINI_API_KEY", "wxyz", "ok"])
  assert.equal(fake.requests.at(-1)?.headers["x-goog-api-key"], "good-key-AIzaFromEnv-wxyz")
})
