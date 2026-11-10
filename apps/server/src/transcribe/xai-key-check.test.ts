import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { type FakeKeyServices, startFakeKeyServices, UNREACHABLE } from "../secrets/testing/fake-key-services.ts"
import { checkXaiKey } from "./xai-key-check.ts"

let fake: FakeKeyServices
before(async () => {
  fake = await startFakeKeyServices()
})
after(() => fake.close())

const run = (key: string, base = fake.base) => Effect.runPromise(checkXaiKey(base, key).pipe(Effect.provide(FetchHttpClient.layer)))

test("an xAI key is read from its own record: working, switched off, or on a blocked team", async () => {
  assert.deepEqual(await run("good-key-xai"), { code: "ok", message: "Works.", models: null })
  assert.equal((await run("off-key-xai")).code, "refused")
  const broke = await run("broke-key-xai")
  assert.equal(broke.code, "no-credit")
  assert.match(broke.message, /no credit/)
})

test("a wrong xAI key (a 400 there) is refused without echoing the key; a down service is unreachable", async () => {
  const bad = await run("bad-key-xai-0123456789")
  assert.deepEqual([bad.code, bad.message], ["refused", "xAI refused this key (it isn't a valid API key)."])
  assert.equal((await run("good-key-xai", UNREACHABLE)).code, "unreachable")
  assert.equal((await run("down-key-xai")).code, "unreachable")
})
