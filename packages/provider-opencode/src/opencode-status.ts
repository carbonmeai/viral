import { Effect, Option, Schema, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { atLeast, MIN_OPENCODE_VERSION, opencodeVersion } from "./opencode-server.ts"

export interface OpencodeStatus {
  // "2.2.6"; none when OpenCode isn't installed
  readonly version: Option.Option<string>
  // older than MIN_OPENCODE_VERSION: Viral won't run it until it's updated
  readonly outdated: boolean
  // a credential for at least one provider: a sign-in (`opencode auth login`, e.g. the OpenCode Console) or an API
  // key in the environment. With none, the OpenCode Zen models alone don't count: outside OpenCode's own apps its
  // free ones answer "Free usage limit reached"
  readonly signedIn: boolean
  // provider/model ids
  readonly models: ReadonlyArray<string>
}

// `opencode auth list --format json`: each integration (provider) and the credentials it has
const Integrations = Schema.Array(Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  connections: Schema.Array(Schema.Unknown)
}))

// The integrations that have a credential, by id ("opencode" is the OpenCode Console / Zen)
export const connectedIntegrations = (json: string): ReadonlyArray<string> =>
  Schema.decodeOption(Schema.fromJsonString(Integrations))(json.trim()).pipe(
    Option.map((list) => list.flatMap((integration) => integration.connections.length > 0 ? [integration.id] : [])),
    Option.getOrElse(() => [])
  )

// What Settings shows for OpenCode: installed, new enough, signed in, and its models. Asked of a private server
// (`--standalone`), not OpenCode's background service, so the answer reflects this environment's keys, as Viral's
// own `opencode serve` will see them.
export const opencodeStatus = Effect.fn("opencodeStatus")(function*(command: readonly [string, ...Array<string>] = ["opencode"]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const [bin, ...lead] = command
  const version = yield* opencodeVersion(command)
  const none: OpencodeStatus = { version, outdated: false, signedIn: false, models: [] }
  if (Option.isNone(version)) return none
  if (!atLeast(version.value, MIN_OPENCODE_VERSION)) return { ...none, outdated: true }
  const output = (args: ReadonlyArray<string>) =>
    spawner.string(ChildProcess.make(bin, [...lead, ...args, "--standalone"])).pipe(Effect.orElseSucceed(() => ""))
  const [auth, list] = yield* Effect.all([output(["auth", "list", "--format", "json"]), output(["models"])], { concurrency: "unbounded" })
  const models = list.split("\n").map(Str.trim).filter((line) => /^[\w.-]+\/\S+$/.test(line))
  return {
    ...none,
    signedIn: connectedIntegrations(auth).length > 0 || models.some((model) => !model.startsWith("opencode/")),
    models
  }
})
