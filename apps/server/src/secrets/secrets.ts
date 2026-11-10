import type { KeyName } from "@viral/contracts"
import { Config, Context, Effect, Layer, Option, Redacted, String as Str } from "effect"
import { type KeychainOptions, SecretsError, SecretStore } from "./secret-store.ts"

export { SecretsError } from "./secret-store.ts"

// API keys Viral uses, each with the environment variables that win over the saved key, in the order they're read.
// Google's first name is the AI SDK's; GEMINI_API_KEY is Google's own.
export const SECRETS: Record<KeyName, ReadonlyArray<string>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  // the Vercel AI Gateway, for running agent stages on other models
  gateway: ["AI_GATEWAY_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY"],
  xai: ["XAI_API_KEY"]
}
export type SecretName = KeyName

// Keys are tokens: letters, digits and a few separators.
const KEY_SHAPE = /^[A-Za-z0-9_\-.:]+$/

// A pasted key, trimmed; None when it can't be a key (spaces inside, quotes, other characters).
export const normalizeKey = (value: string): Option.Option<string> => {
  const key = Str.trim(value)
  return KEY_SHAPE.test(key) ? Option.some(key) : Option.none()
}

// The last four characters of a key long enough that they give nothing away; null otherwise.
export const lastFour = (key: string): string | null => key.length >= 12 ? key.slice(-4) : null

// Where a key comes from right now, without its value.
export interface SecretInfo {
  readonly source: Option.Option<"environment" | "keychain">
  // the environment variable the key comes from, when it does
  readonly envVar: string | null
  readonly last4: string | null
}

interface Current {
  readonly source: "environment" | "keychain"
  readonly envVar: string | null
  readonly key: string
}

// The keys Viral uses. An environment variable wins, for development and CI; otherwise the key saved in Settings
// (SecretStore: the macOS Keychain). Keys are never stored in the database, never returned to a client (only their
// last four characters) and never logged. A saved key is never put into process.env either: it's read when a call
// needs it and handed only to that call.
export class Secrets extends Context.Service<Secrets, {
  get(name: SecretName): Effect.Effect<Option.Option<Redacted.Redacted<string>>>
  // where a key comes from right now, without its value
  source(name: SecretName): Effect.Effect<Option.Option<"environment" | "keychain">>
  info(name: SecretName): Effect.Effect<SecretInfo>
  set(name: SecretName, value: Redacted.Redacted<string>): Effect.Effect<void, SecretsError>
  remove(name: SecretName): Effect.Effect<void, SecretsError>
}>()("@viral/server/secrets/secrets") {
  static readonly make = Effect.gen(function*() {
    const store = yield* SecretStore

    // the first of the key's variables that is set and not empty
    const fromEnv = Effect.fn("Secrets.fromEnv")(function*(name: SecretName) {
      for (const variable of SECRETS[name]) {
        const value = yield* Config.option(Config.String(variable)).pipe(Effect.orDie)
        const key = Option.filter(Option.map(value, Str.trim), (v) => v !== "")
        if (Option.isSome(key)) return Option.some({ variable, key: key.value })
      }
      return Option.none<{ readonly variable: string; readonly key: string }>()
    })

    const current = Effect.fn("Secrets.current")(function*(name: SecretName) {
      const env = yield* fromEnv(name)
      if (Option.isSome(env)) return Option.some<Current>({ source: "environment", envVar: env.value.variable, key: env.value.key })
      return Option.map(yield* store.read(name), (key): Current => ({ source: "keychain", envVar: null, key }))
    })

    const get = (name: SecretName) => Effect.map(current(name), Option.map((c) => Redacted.make(c.key)))
    const source = (name: SecretName) => Effect.map(current(name), Option.map((c) => c.source))
    const info = (name: SecretName) =>
      Effect.map(current(name), (c): SecretInfo => ({
        source: Option.map(c, (x) => x.source),
        envVar: Option.match(c, { onNone: () => null, onSome: (x) => x.envVar }),
        last4: Option.match(c, { onNone: () => null, onSome: (x) => lastFour(x.key) })
      }))

    const set = Effect.fn("Secrets.set")(function*(name: SecretName, value: Redacted.Redacted<string>) {
      const key = normalizeKey(Redacted.value(value))
      if (Option.isNone(key)) return yield* new SecretsError({ code: "invalid", message: "that doesn't look like an API key" })
      yield* store.write(name, key.value)
    })

    const remove = (name: SecretName) => store.delete(name)

    return Secrets.of({ get, source, info, set, remove })
  })

  // the Keychain store; tests point `security` at a fake
  static readonly layerWith = (options: KeychainOptions) =>
    Layer.effect(Secrets, Secrets.make).pipe(Layer.provide(SecretStore.keychain(options)))

  static readonly layer = Secrets.layerWith({})
}
