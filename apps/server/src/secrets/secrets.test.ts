import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { lastFour, normalizeKey, Secrets } from "./secrets.ts"
import { writeFakeSecurity } from "./testing/fake-security.ts"

let dir: string
let security: string
before(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-secrets-")))
  security = writeFakeSecurity(dir)
})
after(() => rmSync(dir, { recursive: true, force: true }))

// no key variables: the test gives its own environment, never the real one
const run = <A, E>(effect: Effect.Effect<A, E, Secrets>, env: Record<string, string> = {}) =>
  Effect.runPromise(effect.pipe(
    Effect.provide(Layer.mergeAll(Secrets.layerWith({ security }), ConfigProvider.layer(ConfigProvider.fromUnknown(env))))
  ))

test("a key is saved to and removed from the Keychain without ever being in a command line", async () => {
  await run(Effect.gen(function*() {
    const secrets = yield* Secrets
    assert.deepEqual(yield* secrets.source("elevenlabs"), Option.none())
    yield* secrets.set("elevenlabs", Redacted.make(" sk_live_123 "))
    assert.deepEqual(yield* secrets.source("elevenlabs"), Option.some("keychain"))
    assert.equal(Option.map(yield* secrets.get("elevenlabs"), Redacted.value).pipe(Option.getOrNull), "sk_live_123")
    yield* secrets.remove("elevenlabs")
    assert.deepEqual(yield* secrets.source("elevenlabs"), Option.none())
  }))
  assert.doesNotMatch(readFileSync(join(dir, "argv.log"), "utf8"), /sk_live_123/, "the key never appears in argv")
  assert.match(readFileSync(join(dir, "stdin.log"), "utf8"), /add-generic-password -U -s viral -a elevenlabs -w sk_live_123/)
})

test("the environment wins, and a malformed key is refused before it reaches the Keychain", async () => {
  await run(Effect.gen(function*() {
    const secrets = yield* Secrets
    assert.deepEqual(yield* secrets.source("xai"), Option.some("environment"))
    const refused = yield* secrets.set("xai", Redacted.make("two words; rm -rf")).pipe(Effect.flip)
    assert.equal(refused.code, "invalid")
  }), { XAI_API_KEY: "from-env" })
})


test("Google's key also comes from GEMINI_API_KEY; an empty variable doesn't count; info names the variable and shows 4 characters", async () => {
  await run(Effect.gen(function*() {
    const secrets = yield* Secrets
    const google = yield* secrets.info("google")
    assert.deepEqual([google.source, google.envVar, google.last4], [Option.some("environment"), "GEMINI_API_KEY", "wxyz"])
    assert.deepEqual(yield* secrets.source("openai"), Option.none(), "OPENAI_API_KEY is empty")
    yield* secrets.set("openrouter", Redacted.make("sk-or-v1-abcdefgh1234"))
    const saved = yield* secrets.info("openrouter")
    assert.deepEqual([saved.source, saved.envVar, saved.last4], [Option.some("keychain"), null, "1234"])
    yield* secrets.remove("openrouter")
  }), { GEMINI_API_KEY: "AIzaSyExample-abcdwxyz", OPENAI_API_KEY: "  " })
})

test("only well-formed keys are taken, and short ones show none of their characters", () => {
  assert.deepEqual(normalizeKey("  sk-ant-api03-abc_DEF.1:2  "), Option.some("sk-ant-api03-abc_DEF.1:2"))
  assert.deepEqual(normalizeKey("sk ant"), Option.none())
  assert.deepEqual(normalizeKey("\"sk-quoted\""), Option.none())
  assert.equal(lastFour("abcdefghijkl"), "ijkl")
  assert.equal(lastFour("short-key"), null)
})
