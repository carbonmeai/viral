import { NodeServices } from "@effect/platform-node"
import { Config, Context, Effect, Layer, Option, Redacted, Schema, Stream, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

// API keys Viral uses, with the environment variable that overrides the Keychain entry.
export const SECRETS = {
  xai: "XAI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  // the Vercel AI Gateway, for running agent stages on other models (experimental; evals)
  gateway: "AI_GATEWAY_API_KEY"
} as const
export type SecretName = keyof typeof SECRETS

// `code`: "invalid" (a value the Keychain command can't carry) or "keychain" (the security command failed).
export class SecretsError extends Schema.TaggedError<SecretsError>()("SecretsError", {
  code: Schema.String,
  message: Schema.String
}) {}

export interface SecretsOptions {
  // the macOS `security` command; tests point it at a fake
  readonly security?: string
}

const SERVICE = "viral"
// keys are tokens: letters, digits and a few separators. Anything else could break the command line.
const KEY_SHAPE = /^[A-Za-z0-9_\-.:]+$/

// Keys live in the macOS Keychain as generic passwords with service "viral" and the secret's name as the
// account. An environment variable of the same purpose wins, for development and CI. Keys are never stored in
// the database, never returned to a client and never logged; writes go to `security -i` on stdin, so a key
// never shows up in the process list either.
export class Secrets extends Context.Service<Secrets, {
  get(name: SecretName): Effect.Effect<Option.Option<Redacted.Redacted<string>>>
  // where a key comes from right now, without its value
  source(name: SecretName): Effect.Effect<Option.Option<"environment" | "keychain">>
  set(name: SecretName, value: Redacted.Redacted<string>): Effect.Effect<void, SecretsError>
  remove(name: SecretName): Effect.Effect<void, SecretsError>
}>()("@viral/server/secrets/secrets") {
  static readonly make = Effect.fn("Secrets.make")(function*(options: SecretsOptions = {}) {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const security = options.security ?? "security"
      const fail = (code: string) => (error: { readonly message: string }) => new SecretsError({ code, message: error.message })

      const fromKeychain = (name: SecretName) =>
        spawner.string(ChildProcess.make(security, ["find-generic-password", "-s", SERVICE, "-a", name, "-w"])).pipe(
          Effect.map((value) => Option.some(Str.trim(value)).pipe(Option.filter((key) => key !== ""))),
          // not found, or not on macOS
          Effect.orElseSucceed(() => Option.none<string>())
        )
      const fromEnv = (name: SecretName) => Config.option(Config.String(SECRETS[name])).pipe(Effect.orDie)

      // Runs one Keychain command through `security -i`, which reads it from stdin.
      const keychain = (command: string) =>
        spawner.exitCode(ChildProcess.make(security, ["-i"], {
          stdin: Stream.make(new TextEncoder().encode(`${command}\n`))
        })).pipe(
          Effect.mapError(fail("keychain")),
          Effect.flatMap((code) =>
            code === ChildProcessSpawner.ExitCode(0)
              ? Effect.void
              : Effect.fail(new SecretsError({ code: "keychain", message: `the Keychain command exited with ${code}` }))
          )
        )

      const get = Effect.fn("Secrets.get")(function*(name: SecretName) {
        const env = yield* fromEnv(name)
        const value = Option.isSome(env) ? env : yield* fromKeychain(name)
        return Option.map(value, Redacted.make)
      })

      const source = Effect.fn("Secrets.source")(function*(name: SecretName) {
        if (Option.isSome(yield* fromEnv(name))) return Option.some("environment" as const)
        return Option.as(yield* fromKeychain(name), "keychain" as const)
      })

      const set = Effect.fn("Secrets.set")(function*(name: SecretName, value: Redacted.Redacted<string>) {
        const key = Str.trim(Redacted.value(value))
        if (!KEY_SHAPE.test(key)) {
          return yield* new SecretsError({ code: "invalid", message: "that doesn't look like an API key" })
        }
        // -U replaces an existing entry
        yield* keychain(`add-generic-password -U -s ${SERVICE} -a ${name} -w ${key}`)
      })

      const remove = Effect.fn("Secrets.remove")(function*(name: SecretName) {
        if (Option.isNone(yield* fromKeychain(name))) return
        yield* keychain(`delete-generic-password -s ${SERVICE} -a ${name}`)
      })

      return Secrets.of({ get, source, set, remove })
  })

  static readonly layerWith = (options: SecretsOptions) =>
    Layer.effect(Secrets, Secrets.make(options)).pipe(Layer.provide(NodeServices.layer))

  static readonly layer = Secrets.layerWith({})
}
