import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Secrets } from "./secrets.ts"

let dir: string
let security: string
// A fake `security`: the Keychain is one file per account; every command line it was given is logged, so the
// test can check a key never appears in the arguments.
before(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-secrets-")))
  security = join(dir, "security")
  writeFileSync(security, `#!/bin/sh
D="${dir}"
echo "$*" >> "$D/argv.log"
if [ "$1" = "find-generic-password" ]; then
  [ -f "$D/item-$5" ] || exit 44
  cat "$D/item-$5"; exit 0
fi
if [ "$1" = "-i" ]; then
  read -r line
  echo "$line" >> "$D/stdin.log"
  set -- $line
  if [ "$1" = "add-generic-password" ]; then printf "%s" "$8" > "$D/item-$6"; exit 0; fi
  if [ "$1" = "delete-generic-password" ]; then rm -f "$D/item-$5"; exit 0; fi
fi
exit 1
`)
  chmodSync(security, 0o755)
})
after(() => rmSync(dir, { recursive: true, force: true }))

// no ELEVENLABS_API_KEY / XAI_API_KEY in the environment
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

