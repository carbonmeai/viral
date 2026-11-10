import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { KeyCheckFn } from "../secrets/key-probe.ts"
import { type FakeKeyServices, startFakeKeyServices, UNREACHABLE } from "../secrets/testing/fake-key-services.ts"
import { checkAnthropicKey, checkGatewayKey, checkGoogleKey, checkOpenAiKey, checkOpenRouterKey } from "./model-key-checks.ts"

let fake: FakeKeyServices
before(async () => {
  fake = await startFakeKeyServices()
})
after(() => fake.close())

const run = (check: KeyCheckFn, key: string, base = fake.base) => Effect.runPromise(check(base, key).pipe(Effect.provide(FetchHttpClient.layer)))

test("each model key's check lists its models or reads its credit, and says so in plain words", async () => {
  assert.deepEqual(await run(checkAnthropicKey, "good-key-anthropic"), { code: "ok", message: "Works. 3 models available.", models: 3 })
  assert.deepEqual(await run(checkOpenAiKey, "good-key-openai"), { code: "ok", message: "Works. 5 models available.", models: 5 })
  assert.deepEqual(await run(checkGoogleKey, "good-key-google"), { code: "ok", message: "Works. 2 models available.", models: 2 }, "only text models")
  assert.deepEqual(await run(checkOpenRouterKey, "good-key-openrouter"), { code: "ok", message: "Works. $7.50 left on this key.", models: null })
  assert.deepEqual(await run(checkGatewayKey, "good-key-gateway"), { code: "ok", message: "Works. $12.50 credit left.", models: null })
})

test("a wrong key is refused, with the service's reason and never the key", async () => {
  const anthropic = await run(checkAnthropicKey, "bad-key-anthropic")
  assert.equal(anthropic.code, "refused")
  assert.equal(anthropic.message, "Anthropic refused this key (invalid x-api-key).")
  const openai = await run(checkOpenAiKey, "bad-key-sk-proj-0123456789")
  assert.equal(openai.code, "refused")
  assert.doesNotMatch(openai.message, /0123456789/, "OpenAI's echo of the key is redacted")
  assert.match(openai.message, /\[redacted\]/)
  const google = await run(checkGoogleKey, "bad-key-google")
  assert.deepEqual([google.code, google.message], ["refused", "Google refused this key (it isn't a valid API key)."], "Google's 400")
  const off = await run(checkGoogleKey, "off-key-google")
  assert.equal(off.code, "refused")
  assert.match(off.message, /has not been used in this project/)
  assert.equal((await run(checkOpenRouterKey, "bad-key-openrouter")).code, "refused")
  assert.equal((await run(checkGatewayKey, "bad-key-gateway")).code, "refused")
})

test("credit that's used up is no-credit; a free OpenRouter account says it runs free models only", async () => {
  const router = await run(checkOpenRouterKey, "broke-key-openrouter")
  assert.equal(router.code, "no-credit")
  const gateway = await run(checkGatewayKey, "broke-key-gateway")
  assert.equal(gateway.code, "no-credit")
  assert.match(gateway.message, /BYOK/)
  const free = await run(checkOpenRouterKey, "free-key-openrouter")
  assert.equal(free.code, "ok")
  assert.match(free.message, /free tier/)
})

test("a failing or unreachable service is unreachable (it says nothing about the key); a busy one says to try again", async () => {
  for (const check of [checkAnthropicKey, checkOpenAiKey, checkGoogleKey, checkOpenRouterKey, checkGatewayKey]) {
    assert.equal((await run(check, "down-key-x")).code, "unreachable")
    assert.equal((await run(check, "good-key-x", UNREACHABLE)).code, "unreachable")
  }
  const busy = await run(checkOpenAiKey, "busy-key-openai")
  assert.equal(busy.code, "unknown")
  assert.match(busy.message, /Test again in a minute/)
})

test("keys travel in headers only: Google's never in the URL, the gateway's with its auth method", async () => {
  fake.requests.length = 0
  await run(checkGoogleKey, "good-key-google-header")
  await run(checkGatewayKey, "good-key-gateway-header")
  await run(checkAnthropicKey, "good-key-anthropic-header")
  const [google, gateway, anthropic] = fake.requests
  assert.equal(google?.headers["x-goog-api-key"], "good-key-google-header")
  assert.doesNotMatch(google?.url ?? "", /key=/)
  assert.equal(gateway?.headers.authorization, "Bearer good-key-gateway-header")
  assert.equal(gateway?.headers["ai-gateway-auth-method"], "api-key")
  assert.equal(anthropic?.headers["anthropic-version"], "2023-06-01")
  assert.match(anthropic?.url ?? "", /limit=1000/)
})
