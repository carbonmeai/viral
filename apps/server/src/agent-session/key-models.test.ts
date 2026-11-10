import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import assert from "node:assert/strict"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Secrets } from "../secrets/secrets.ts"
import { type FakeKeyServices, startFakeKeyServices, UNREACHABLE } from "../secrets/testing/fake-key-services.ts"
import { writeFakeSecurity } from "../secrets/testing/fake-security.ts"
import { KeyModelLists } from "./key-models.ts"

let dir: string
let home: string
let security: string
let fake: FakeKeyServices
before(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-key-models-")))
  home = mkdtempSync(join(tmpdir(), "viral-key-models-home-"))
  security = writeFakeSecurity(dir)
  fake = await startFakeKeyServices()
})
after(async () => {
  await fake.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

// Every vendor at the fake (keys from the environment the test gives, never the real one).
const run = <A, E>(effect: Effect.Effect<A, E, KeyModelLists>, env: Record<string, string>) => {
  const services = Object.fromEntries(
    ["ANTHROPIC_API_URL", "OPENAI_API_URL", "GOOGLE_API_URL", "OPENROUTER_API_URL", "AI_GATEWAY_API_URL"].map((name) => [name, fake.base])
  )
  const config = ConfigProvider.layer(ConfigProvider.fromUnknown({ VIRAL_HOME: home, ...services, ...env }))
  const layer = Layer.effect(KeyModelLists, KeyModelLists.make).pipe(
    Layer.provide([Secrets.layerWith({ security }), FetchHttpClient.layer]),
    Layer.provideMerge(config)
  )
  const rt = ManagedRuntime.make(layer)
  return rt.runPromise(effect).finally(() => rt.dispose())
}

const ids = (models: ReadonlyArray<{ readonly id: string }>) => models.map((m) => m.id).sort()

test("each vendor's list is read the vendor's way, keeping only models that can answer with tools", async () => {
  const lists = await run(
    Effect.all({
      anthropic: KeyModelLists.use((l) => l.list("anthropic")),
      openai: KeyModelLists.use((l) => l.list("openai")),
      google: KeyModelLists.use((l) => l.list("google")),
      openrouter: KeyModelLists.use((l) => l.list("openrouter")),
      gateway: KeyModelLists.use((l) => l.list("ai-gateway"))
    }),
    {
      ANTHROPIC_API_KEY: "good-key-anthropic-0001",
      OPENAI_API_KEY: "good-key-openai-0001",
      GOOGLE_GENERATIVE_AI_API_KEY: "good-key-google-0001",
      OPENROUTER_API_KEY: "good-key-openrouter-0001",
      AI_GATEWAY_API_KEY: "good-key-gateway-0001"
    }
  )
  assert.deepEqual(ids(lists.anthropic.models), ["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"])
  assert.ok(lists.anthropic.models.every((m) => m.vision === true))
  assert.deepEqual(ids(lists.openai.models), ["gpt-5", "gpt-6", "gpt-6-luna", "o9"], "speech models aren't offered")
  assert.deepEqual(ids(lists.google.models), ["gemini-3.5-flash", "gemini-3.5-pro"], "only models that generate text")
  assert.deepEqual(ids(lists.openrouter.models), ["anthropic/claude-haiku-5.5", "meta-llama/llama-9-8b"], "only models that take tools")
  assert.deepEqual(lists.openrouter.models.map((m) => [m.id, m.vision]), [["anthropic/claude-haiku-5.5", true], ["meta-llama/llama-9-8b", false]])
  assert.deepEqual(ids(lists.gateway.models), ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna"])
  for (const list of Object.values(lists)) {
    assert.equal(list.problem, null)
    assert.ok(list.fetchedAt !== null)
  }
  // Google's key went in the header, never in the URL
  const google = fake.requests.find((r) => r.url.startsWith("/v1beta/models"))!
  assert.equal(google.headers["x-goog-api-key"], "good-key-google-0001")
  assert.doesNotMatch(google.url, /key=/)
})

test("a list is kept for a day: asking again doesn't call the vendor", async () => {
  const before = fake.requests.length
  await run(
    Effect.gen(function*() {
      const lists = yield* KeyModelLists
      yield* lists.list("anthropic")
      yield* lists.list("anthropic")
    }),
    { ANTHROPIC_API_KEY: "good-key-anthropic-0002" }
  )
  assert.equal(fake.requests.length - before, 1)
})

test("no key, a refused key and an unreachable vendor are plain problems, never errors", async () => {
  const none = await run(KeyModelLists.use((l) => l.list("openai")), {})
  assert.deepEqual([none.models, none.problem], [[], "Add a key in Accounts."])

  const refused = await run(KeyModelLists.use((l) => l.list("openrouter")), { OPENROUTER_API_KEY: "bad-key-openrouter-0001" })
  assert.equal(refused.problem, "OpenRouter refused this key. Check it in Accounts.")

  const badGoogle = await run(KeyModelLists.use((l) => l.list("google")), { GOOGLE_GENERATIVE_AI_API_KEY: "bad-key-google-0001" })
  assert.match(badGoogle.problem ?? "", /refused/)

  const down = await run(KeyModelLists.use((l) => l.list("anthropic")), { ANTHROPIC_API_KEY: "good-key-anthropic-0003", ANTHROPIC_API_URL: UNREACHABLE })
  assert.equal(down.problem, "Couldn't reach Anthropic.")
})
