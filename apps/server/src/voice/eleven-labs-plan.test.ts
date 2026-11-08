import { ConfigProvider, Effect, Layer } from "effect"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, test } from "node:test"
import { ElevenLabs, usdPerCharacter } from "./eleven-labs.ts"

// A fake ElevenLabs answering GET /v1/user/subscription: a full key, one missing the User read permission, or down.
let server: Server
let base: string
let asked = 0
const subscription = {
  tier: "creator",
  character_count: 41_250,
  character_limit: 100_000,
  next_character_count_reset_unix: 1_765_000_000,
  currency: "usd",
  billing_period: "monthly_period",
  next_invoice: { amount_due_cents: 2200, discount_percent_off: null, next_payment_attempt_unix: 1_765_000_000 },
  voice_limit: 30,
  status: "active"
}

before(async () => {
  server = createServer((req, res) => {
    const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value))
    if (req.method !== "GET" || req.url !== "/v1/user/subscription") return json(404, { detail: "not found" })
    asked++
    const key = req.headers["xi-api-key"]
    if (key === "full-key") return json(200, subscription)
    if (key === "tts-only") {
      return json(401, {
        detail: { type: "authentication_error", code: "unauthorized", message: "The API key you used is missing the permission user_read to execute this operation." }
      })
    }
    json(500, { detail: "down" })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => void server.close())

const plan = (config: Record<string, string>, times = 1) =>
  Effect.runPromise(Effect.gen(function*() {
    const eleven = yield* ElevenLabs
    let last = yield* eleven.plan
    for (let i = 1; i < times; i++) last = yield* eleven.plan
    return last
  }).pipe(Effect.provide(ElevenLabs.layer.pipe(
    Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown({ ELEVENLABS_API_URL: base, ...config })))
  ))))

test("the plan's characters, reset date and per-character price come from the subscription, asked once a minute", async () => {
  asked = 0
  const result = await plan({ ELEVENLABS_API_KEY: "full-key" }, 3)
  assert.equal(asked, 1, "cached between reads")
  assert.equal(result._tag, "Plan")
  if (result._tag !== "Plan") return
  assert.deepEqual([result.tier, result.charactersUsed, result.characterLimit], ["creator", 41_250, 100_000])
  assert.equal(result.resetsAt, "2025-12-06T05:46:40.000Z")
  assert.equal(result.usdPerCharacter, 22 / 100_000)
})

test("a key without the User read permission says so instead of failing the page", async () => {
  const result = await plan({ ELEVENLABS_API_KEY: "tts-only" })
  assert.equal(result._tag, "Unavailable")
  if (result._tag === "Unavailable") assert.equal(result.reason, "no-permission")
  const down = await plan({ ELEVENLABS_API_KEY: "other" })
  assert.equal(down._tag === "Unavailable" && down.reason, "failed")
})

test("no price is invented: free plans, other currencies and missing invoices have none", () => {
  const base = { tier: "free", character_count: 0, character_limit: 10_000 }
  assert.equal(usdPerCharacter(base), null)
  assert.equal(usdPerCharacter({ ...base, next_invoice: null }), null)
  assert.equal(usdPerCharacter({ ...base, next_invoice: { amount_due_cents: 0 } }), null)
  assert.equal(usdPerCharacter({ ...base, currency: "eur", next_invoice: { amount_due_cents: 500 } }), null)
  assert.equal(usdPerCharacter({ ...base, billing_period: "annual_period", next_invoice: { amount_due_cents: 12_000 } }), 10 / 10_000)
})
