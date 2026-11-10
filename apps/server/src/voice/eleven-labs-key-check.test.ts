import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { type FakeKeyServices, startFakeKeyServices, UNREACHABLE } from "../secrets/testing/fake-key-services.ts"
import { checkElevenLabsKey } from "./eleven-labs-key-check.ts"

let fake: FakeKeyServices
before(async () => {
  fake = await startFakeKeyServices()
})
after(() => fake.close())

const run = (key: string, base = fake.base) => Effect.runPromise(checkElevenLabsKey(base, key).pipe(Effect.provide(FetchHttpClient.layer)))

test("an ElevenLabs key works, names its plan, and is sent as xi-api-key", async () => {
  fake.requests.length = 0
  assert.deepEqual(await run("good-key-eleven"), { code: "ok", message: "Works, on the creator plan.", models: null })
  assert.equal(fake.requests[0]?.headers["xi-api-key"], "good-key-eleven")
})

test("a key without the User read permission still works and says what it can't show; a wrong one is refused", async () => {
  const limited = await run("limited-key-eleven")
  assert.equal(limited.code, "ok")
  assert.match(limited.message, /User: read/)
  const bad = await run("bad-key-eleven")
  assert.deepEqual([bad.code, bad.message], ["refused", "ElevenLabs refused this key (Invalid API key)."])
  assert.equal((await run("good-key-eleven", UNREACHABLE)).code, "unreachable")
  assert.equal((await run("down-key-eleven")).code, "unreachable")
})
