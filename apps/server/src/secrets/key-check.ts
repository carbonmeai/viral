import { type KeyCheck, type KeyName, KeyCheck as KeyCheckSchema } from "@viral/contracts"
import { Config, Context, DateTime, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { MODEL_KEY_CHECKS } from "../agent-session/model-key-checks.ts"
import { Settings } from "../settings/settings.ts"
import { XAI_KEY_CHECK } from "../transcribe/xai-key-check.ts"
import { ELEVENLABS_KEY_CHECK } from "../voice/eleven-labs-key-check.ts"
import type { KeyCheckFn } from "./key-probe.ts"

// Every key's free check, from the domain that owns the key, with the service's address and the variable that
// moves it (only tests do: they point it at a fake server).
const CHECKS: Record<KeyName, { readonly check: KeyCheckFn; readonly base: string; readonly override: string }> = {
  ...MODEL_KEY_CHECKS,
  elevenlabs: ELEVENLABS_KEY_CHECK,
  xai: XAI_KEY_CHECK
}

// The settings key a key's last check is kept under: the result only, never the key.
export const keyCheckSetting = (name: KeyName) => `keys.${name}.check`

// Tests a key with one free call to its service (listing models or reading the key's info; no tokens), and keeps
// the last result for the key in use so Accounts can show it.
export class KeyChecks extends Context.Service<KeyChecks, {
  check(name: KeyName, key: Redacted.Redacted<string>): Effect.Effect<KeyCheck>
  last(name: KeyName): Effect.Effect<KeyCheck | null>
  remember(name: KeyName, check: KeyCheck): Effect.Effect<void>
  forget(name: KeyName): Effect.Effect<void>
}>()("@viral/server/secrets/key-check/KeyChecks") {
  static readonly make = Effect.gen(function*() {
    const settings = yield* Settings
    const client = yield* HttpClient.HttpClient

    const check = Effect.fn("KeyChecks.check")(function*(name: KeyName, key: Redacted.Redacted<string>) {
      const entry = CHECKS[name]
      const base = yield* Config.String(entry.override).pipe(Config.withDefault(entry.base), Effect.orDie)
      const found = yield* entry.check(base.replace(/\/+$/, ""), Redacted.value(key)).pipe(
        Effect.provideService(HttpClient.HttpClient, client)
      )
      return { ...found, checkedAt: DateTime.formatIso(yield* DateTime.now) } satisfies KeyCheck
    })

    const last = Effect.fn("KeyChecks.last")(function*(name: KeyName) {
      return Option.getOrNull(yield* settings.get(keyCheckSetting(name), KeyCheckSchema))
    })
    const remember = Effect.fn("KeyChecks.remember")(function*(name: KeyName, result: KeyCheck) {
      yield* settings.set(keyCheckSetting(name), result)
    })
    const forget = Effect.fn("KeyChecks.forget")(function*(name: KeyName) {
      yield* settings.remove(keyCheckSetting(name))
    })

    return KeyChecks.of({ check, last, remember, forget })
  })

  static readonly layer = Layer.effect(KeyChecks, KeyChecks.make).pipe(Layer.provide([Settings.layer, FetchHttpClient.layer]))
}
