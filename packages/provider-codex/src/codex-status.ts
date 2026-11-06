import { Effect, Option, Schema, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { codexClient } from "./codex-client.ts"
import { type CodexModel, launchArgs, listModels } from "./codex-provider.ts"

const Account = Schema.Struct({
  account: Schema.NullOr(Schema.Struct({
    type: Schema.String,
    email: Schema.optional(Schema.NullOr(Schema.String)),
    planType: Schema.optional(Schema.NullOr(Schema.String))
  }))
})

export interface CodexStatus {
  // `codex --version`, e.g. "codex-cli 0.154.0"; none when Codex isn't installed
  readonly version: Option.Option<string>
  // how it's signed in ("chatgpt" or "apiKey") and the plan; none when signed out
  readonly account: Option.Option<{ readonly type: string; readonly plan: string | null }>
  // the models this account can use
  readonly models: ReadonlyArray<CodexModel>
}

const STATUS_TIMEOUT = "20 seconds"

// What Settings shows for Codex: installed, signed in, and the account's models. Asks an app-server (the same
// isolated launch a run uses), so it takes a second or two.
export const codexStatus = Effect.fn("codexStatus")(function*(command: readonly [string, ...Array<string>] = ["codex"]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const [bin, ...lead] = command
  const version = yield* spawner.string(ChildProcess.make(bin, [...lead, "--version"])).pipe(
    Effect.map((out) => Option.some(Str.trim(out))),
    Effect.orElseSucceed(() => Option.none<string>())
  )
  if (Option.isNone(version)) return { version, account: Option.none(), models: [] } satisfies CodexStatus

  const signedIn = Effect.gen(function*() {
    const client = yield* codexClient(ChildProcess.make(bin, [...lead, ...launchArgs([], false)], { stdin: "pipe", detached: true }))
    yield* client.request("initialize", { clientInfo: { name: "viral", title: "Viral", version: "1.0.0" }, capabilities: null }, Schema.Unknown)
    yield* client.notify("initialized")
    const { account } = yield* client.request("account/read", { refreshToken: false }, Account)
    const models = account === null ? [] : yield* listModels(client)
    return {
      version,
      account: Option.fromNullishOr(account).pipe(Option.map((a) => ({ type: a.type, plan: a.planType ?? null }))),
      models
    } satisfies CodexStatus
  }).pipe(Effect.scoped, Effect.timeout(STATUS_TIMEOUT))
  return yield* signedIn.pipe(Effect.orElseSucceed((): CodexStatus => ({ version, account: Option.none(), models: [] })))
})
