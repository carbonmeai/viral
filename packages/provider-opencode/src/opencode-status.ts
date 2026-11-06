import { Effect, Option, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { atLeast, MIN_OPENCODE_VERSION, opencodeVersion } from "./opencode-server.ts"

export interface OpencodeStatus {
  // "1.14.19"; none when OpenCode isn't installed
  readonly version: Option.Option<string>
  // older than MIN_OPENCODE_VERSION: Viral won't run it until it's updated
  readonly outdated: boolean
  // signed in to at least one provider (OpenCode Zen's free models alone don't count: outside OpenCode's own apps
  // they answer "Free usage limit reached")
  readonly signedIn: boolean
  // provider/model ids
  readonly models: ReadonlyArray<string>
}

// The number in `opencode auth list`'s "N credentials" line
export const credentialCount = (text: string) => {
  const match = text.replace(/\u001b\[[0-9;]*m/g, "").match(/(\d+)\s+credentials?/)
  return match === null ? 0 : Number(match[1])
}

// What Settings shows for OpenCode: installed, new enough, signed in, and its models.
export const opencodeStatus = Effect.fn("opencodeStatus")(function*(command: readonly [string, ...Array<string>] = ["opencode"]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const [bin, ...lead] = command
  const version = yield* opencodeVersion(command)
  if (Option.isNone(version)) return { version, outdated: false, signedIn: false, models: [] } satisfies OpencodeStatus
  const output = (args: ReadonlyArray<string>) =>
    spawner.string(ChildProcess.make(bin, [...lead, ...args])).pipe(Effect.orElseSucceed(() => ""))
  const [auth, list] = yield* Effect.all([output(["auth", "list"]), output(["models"])], { concurrency: "unbounded" })
  const models = list.split("\n").map(Str.trim).filter((line) => /^[\w.-]+\/\S+$/.test(line))
  return {
    version,
    outdated: !atLeast(version.value, MIN_OPENCODE_VERSION),
    signedIn: credentialCount(auth) > 0 || models.some((model) => !model.startsWith("opencode/")),
    models
  } satisfies OpencodeStatus
})
