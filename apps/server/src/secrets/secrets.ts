import { NodeServices } from "@effect/platform-node"
import { Config, Context, Effect, Layer, Option, Redacted, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

// API keys Viral uses, with the environment variable that overrides the Keychain entry.
export const SECRETS = {
  xai: "XAI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY"
} as const
export type SecretName = keyof typeof SECRETS

// Keys live in the macOS Keychain as generic passwords with service "viral" and the secret's name as the
// account, e.g. `security add-generic-password -s viral -a xai -w` (prompts for the key). An environment
// variable of the same purpose wins, for development and CI. Keys are never stored in the database.
export class Secrets extends Context.Service<Secrets, {
  get(name: SecretName): Effect.Effect<Option.Option<Redacted.Redacted<string>>>
}>()("@viral/server/secrets/secrets") {
  static readonly layer = Layer.effect(
    Secrets,
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const fromKeychain = (name: SecretName) =>
        spawner.string(ChildProcess.make("security", ["find-generic-password", "-s", "viral", "-a", name, "-w"])).pipe(
          Effect.map((value) => Option.some(Str.trim(value)).pipe(Option.filter((key) => key !== ""))),
          // not found, or not on macOS
          Effect.orElseSucceed(() => Option.none<string>())
        )

      const get = Effect.fn("Secrets.get")(function*(name: SecretName) {
        const fromEnv = yield* Config.option(Config.String(SECRETS[name])).pipe(Effect.orDie)
        const value = Option.isSome(fromEnv) ? fromEnv : yield* fromKeychain(name)
        return Option.map(value, Redacted.make)
      })

      return Secrets.of({ get })
    })
  ).pipe(Layer.provide(NodeServices.layer))
}
