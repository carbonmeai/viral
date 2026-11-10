import { NodeServices } from "@effect/platform-node"
import { Context, Effect, Layer, Option, Schema, Stream, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

// `code`: "invalid" (a value the store can't carry, or that isn't a key), "keychain" (the store failed) or
// "environment" (the key's environment variable is set, so a saved key would be ignored).
export class SecretsError extends Schema.TaggedError<SecretsError>()("SecretsError", {
  code: Schema.String,
  message: Schema.String
}) {}

// Where saved keys live: one value per account name ("anthropic", later "cli.claude.env.ANTHROPIC_AUTH_TOKEN").
// The macOS Keychain today; a Windows or Linux build would add another store here (an encrypted file whose key the
// desktop app holds) without changing `Secrets`. Callers check a value's shape first.
export class SecretStore extends Context.Service<SecretStore, {
  read(account: string): Effect.Effect<Option.Option<string>>
  write(account: string, value: string): Effect.Effect<void, SecretsError>
  delete(account: string): Effect.Effect<void, SecretsError>
}>()("@viral/server/secrets/secret-store/SecretStore") {
  // Generic passwords with service "viral" and the account name. Writes go to `security -i` on stdin, so a key
  // never shows up in the process list.
  static readonly makeKeychain = Effect.fn("SecretStore.makeKeychain")(function*(options: KeychainOptions = {}) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const security = options.security ?? "security"

    const read = (account: string) =>
      spawner.string(ChildProcess.make(security, ["find-generic-password", "-s", SERVICE, "-a", account, "-w"])).pipe(
        Effect.map((value) => Option.some(Str.trim(value)).pipe(Option.filter((key) => key !== ""))),
        // not found, or not on macOS
        Effect.orElseSucceed(() => Option.none<string>())
      )

    // Runs one Keychain command through `security -i`, which reads it from stdin.
    const command = (line: string) =>
      spawner.exitCode(ChildProcess.make(security, ["-i"], {
        stdin: Stream.make(new TextEncoder().encode(`${line}\n`))
      })).pipe(
        Effect.mapError((error) => new SecretsError({ code: "keychain", message: error.message })),
        Effect.flatMap((code) =>
          code === ChildProcessSpawner.ExitCode(0)
            ? Effect.void
            : Effect.fail(new SecretsError({ code: "keychain", message: `the Keychain command exited with ${code}` }))
        )
      )

    const shaped = (value: string) =>
      TOKEN.test(value) ? Effect.void : Effect.fail(new SecretsError({ code: "invalid", message: "the Keychain can't hold that value" }))

    const write = Effect.fn("SecretStore.write")(function*(account: string, value: string) {
      yield* shaped(account)
      yield* shaped(value)
      // -U replaces an existing entry
      yield* command(`add-generic-password -U -s ${SERVICE} -a ${account} -w ${value}`)
    })

    const remove = Effect.fn("SecretStore.delete")(function*(account: string) {
      if (Option.isNone(yield* read(account))) return
      yield* shaped(account)
      yield* command(`delete-generic-password -s ${SERVICE} -a ${account}`)
    })

    return SecretStore.of({ read, write, delete: remove })
  })

  static readonly keychain = (options: KeychainOptions = {}) =>
    Layer.effect(SecretStore, SecretStore.makeKeychain(options)).pipe(Layer.provide(NodeServices.layer))
}

export interface KeychainOptions {
  // the macOS `security` command; tests point it at a fake
  readonly security?: string
}

const SERVICE = "viral"
// tokens only: letters, digits and a few separators. Anything else could break the command line.
const TOKEN = /^[A-Za-z0-9_\-.:]+$/
