import { type Account, type KeyCheck, type KeyName, type SecretSaved, SettingsError } from "@viral/contracts"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { KeyChecks } from "./key-check.ts"
import { normalizeKey, SECRETS, Secrets } from "./secrets.ts"

const invalidKey = () => new SettingsError({ message: "That doesn’t look like an API key. Paste it again, without spaces or quotes." })
const keyError = (error: { readonly message: string }) => new SettingsError({ message: error.message })

// Settings › Accounts for API keys: each key's row (where it comes from, its last four characters, its last check;
// never the key), and adding, testing and removing keys. A pasted key is checked before it's saved.
export class KeyAccounts extends Context.Service<KeyAccounts, {
  account(name: KeyName): Effect.Effect<Account>
  // checks, then saves: a refused key is never saved; an unreachable service saves it anyway
  save(name: KeyName, value: string): Effect.Effect<SecretSaved, SettingsError>
  // a pasted key (only checked), or the key in use (value null), whose result is kept
  test(name: KeyName, value: string | null): Effect.Effect<KeyCheck, SettingsError>
  remove(name: KeyName): Effect.Effect<Account, SettingsError>
}>()("@viral/server/secrets/key-accounts/KeyAccounts") {
  static readonly make = Effect.gen(function*() {
    const secrets = yield* Secrets
    const checks = yield* KeyChecks

    const account = Effect.fn("KeyAccounts.account")(function*(name: KeyName) {
      const info = yield* secrets.info(name)
      return {
        name,
        status: Option.isSome(info.source) ? "ready" : "missing",
        source: Option.getOrNull(info.source),
        detail: null,
        version: null,
        hint: null,
        envVar: info.envVar,
        last4: info.last4,
        check: Option.isSome(info.source) ? yield* checks.last(name) : null
      } satisfies Account
    })

    // While the key's variable is set, a saved key would be ignored, so none is taken.
    const save = Effect.fn("KeyAccounts.save")(function*(name: KeyName, value: string) {
      const info = yield* secrets.info(name)
      if (info.envVar !== null) {
        return yield* new SettingsError({ message: `${info.envVar} is set in the environment, so a saved key would be ignored. Unset it first.` })
      }
      const key = yield* Effect.fromOption(normalizeKey(value)).pipe(Effect.mapError(invalidKey))
      const check = yield* checks.check(name, Redacted.make(key))
      if (check.code === "refused") return yield* new SettingsError({ message: `${check.message} Nothing saved.` })
      yield* secrets.set(name, Redacted.make(key)).pipe(Effect.mapError(keyError))
      // a network problem never throws your key away
      const saved: KeyCheck = check.code === "unreachable" ? { ...check, message: `${check.message} Saved anyway; test again later.` } : check
      yield* checks.remember(name, saved)
      return { account: yield* account(name), check: saved }
    })

    const test = Effect.fn("KeyAccounts.test")(function*(name: KeyName, value: string | null) {
      if (value !== null) {
        const key = yield* Effect.fromOption(normalizeKey(value)).pipe(Effect.mapError(invalidKey))
        return yield* checks.check(name, Redacted.make(key))
      }
      const key = yield* secrets.get(name)
      if (Option.isNone(key)) {
        return yield* new SettingsError({ message: `There’s no key to test. Add one, or set ${SECRETS[name].join(" or ")}.` })
      }
      const check = yield* checks.check(name, key.value)
      yield* checks.remember(name, check)
      return check
    })

    const remove = Effect.fn("KeyAccounts.remove")(function*(name: KeyName) {
      yield* secrets.remove(name).pipe(Effect.mapError(keyError))
      // an environment key stays in use, and so does its last check
      if ((yield* secrets.info(name)).envVar === null) yield* checks.forget(name)
      return yield* account(name)
    })

    return KeyAccounts.of({ account, save, test, remove })
  })

  static readonly layer = Layer.effect(KeyAccounts, KeyAccounts.make).pipe(Layer.provide([Secrets.layer, KeyChecks.layer]))
}
