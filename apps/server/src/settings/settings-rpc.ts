import { type Account, type CliModels, KeyName, SettingsRpcs } from "@viral/contracts"
import { codexStatus } from "@viral/provider-codex"
import { MIN_OPENCODE_VERSION, opencodeStatus, updateHint } from "@viral/provider-opencode"
import { NO_CLI_ENVIRONMENT } from "@viral/provider-core"
import { Effect, FileSystem, Hash, Option, Redacted, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { KeyModelLists } from "../agent-session/key-models.ts"
import { type CliRun, CliSetups } from "../cli-setup/cli-setup.ts"
import { Presets } from "../presets/presets.ts"
import { KeyAccounts } from "../secrets/key-accounts.ts"
import { StorageReport } from "../storage/storage.ts"
import { EvalRecords } from "../eval/eval-records.ts"
import { UsageReport } from "../usage/usage.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { AppSettingsStore } from "./app-settings.ts"

// What tells two setups apart for the status cache: the variables and key by a hash, never the values themselves.
const setupId = (run: CliRun) =>
  Effect.succeed(String(Hash.string(JSON.stringify([
    Object.entries(run.environment.env).sort(),
    run.environment.apiKey === null ? null : [run.environment.apiKey.home, Redacted.value(run.environment.apiKey.key)]
  ]))))

// A CLI's row has no key: no variable, last four characters or check.
type CliAccount = Omit<Account, "envVar" | "last4" | "check">
const cli = (row: CliAccount): Account => ({ ...row, envVar: null, last4: null, check: null })

export const SettingsRpcLive = SettingsRpcs.toLayer(Effect.gen(function*() {
  const keys = yield* KeyAccounts
  const setups = yield* CliSetups
  const fs = yield* FileSystem.FileSystem
  const keyModels = yield* KeyModelLists
  const store = yield* AppSettingsStore
  const presets = yield* Presets
  const storage = yield* StorageReport
  const usage = yield* UsageReport
  const evals = yield* EvalRecords
  const eleven = yield* ElevenLabs
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  // The Claude CLI is usable when it's on the PATH; its version is what we can learn without changing anything.
  // On a key setup, the row says so instead of "signed in".
  const claude = Effect.all([spawner.string(ChildProcess.make("claude", ["--version"])), setups.get("claude")]).pipe(
    Effect.map(([out, setup]): Account => cli({ name: "claude", status: "ready", source: "cli", detail: setup.using ?? (Str.trim(out) || null), version: Str.trim(out).split(" ")[0] ?? null, hint: null })),
    Effect.orElseSucceed((): Account => cli({ name: "claude", status: "missing", source: null, detail: "The Claude CLI isn't on this Mac's PATH", version: null, hint: null }))
  )
  // Codex and OpenCode each take a second or two to ask (Codex starts an app-server), so their answers are kept
  // for a minute; Accounts and the model pickers share them. Each is asked the way a run will start it (on your
  // OpenAI key, with your shared keys), so an answer is kept per setup.
  const perSetup = <A>(ask: (run: CliRun) => Effect.Effect<A>) => {
    const cache = new Map<string, Effect.Effect<A>>()
    return (provider: "codex" | "opencode", fallback: A) =>
      Effect.gen(function*() {
        const run = yield* setups.resolve(provider).pipe(Effect.option)
        // a setup that can't run right now (its key is missing) is asked as on your sign-in
        const used = Option.getOrElse(run, (): CliRun => ({ environment: NO_CLI_ENVIRONMENT, billing: "subscription", costBasis: null }))
        const id = yield* setupId(used)
        let cached = cache.get(id)
        if (cached === undefined) {
          cached = yield* Effect.cachedWithTTL(ask(used), "1 minute")
          cache.set(id, cached)
        }
        return yield* cached
      }).pipe(Effect.orElseSucceed(() => fallback))
  }
  const codexFor = perSetup((run) => codexStatus(["codex"], run.environment).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner), Effect.provideService(FileSystem.FileSystem, fs)))
  const opencodeFor = perSetup((run) => opencodeStatus(["opencode"], run.environment.env).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)))
  const codex = codexFor("codex", { version: Option.none(), account: Option.none(), models: [] })
  const opencode = opencodeFor("opencode", { version: Option.none(), outdated: false, signedIn: false, models: [] })
  const codexAccount = Effect.map(codex, (status): Account => cli(codexRow(status)))
  const codexRow = (status: Effect.Success<typeof codex>): CliAccount => {
    const version = Option.getOrNull(status.version)?.replace(/^codex-cli\s+/, "") ?? null
    if (version === null) {
      return { name: "codex", status: "missing", source: null, detail: null, version, hint: "Install the Codex CLI (npm i -g @openai/codex), then sign in." }
    }
    return Option.match(status.account, {
      onNone: (): CliAccount => ({ name: "codex", status: "signed-out", source: "cli", detail: null, version, hint: "Run `codex login` in Terminal." }),
      onSome: (account): CliAccount => ({
        name: "codex",
        status: "ready",
        source: "cli",
        detail: account.type === "chatgpt" ? `ChatGPT${account.plan === null ? "" : ` (${account.plan})`}` : "Using your OpenAI key",
        version,
        hint: null
      })
    })
  }
  const opencodeAccount = Effect.map(opencode, (status): Account => cli(opencodeRow(status)))
  const opencodeRow = (status: Effect.Success<typeof opencode>): CliAccount => {
    const version = Option.getOrNull(status.version)
    if (version === null) {
      return { name: "opencode", status: "missing", source: null, detail: null, version, hint: "Install OpenCode (opencode.ai), then sign in to a provider." }
    }
    if (status.outdated) {
      return { name: "opencode", status: "outdated", source: "cli", detail: `Viral needs ${MIN_OPENCODE_VERSION} or newer.`, version, hint: updateHint }
    }
    return status.signedIn
      ? { name: "opencode", status: "ready", source: "cli", detail: `${status.models.length} models`, version, hint: null }
      : { name: "opencode", status: "signed-out", source: "cli", detail: null, version, hint: "Run `opencode auth login` in Terminal to add a provider." }
  }
  const cliModels = Effect.all([codex, opencode]).pipe(Effect.map(([c, o]): ReadonlyArray<CliModels> => [
    { provider: "codex", models: c.models.map((m) => ({ id: m.id, label: m.displayName })) },
    { provider: "opencode", models: o.outdated || !o.signedIn ? [] : o.models.map((id) => ({ id, label: id })) }
  ]))

  const setDefaultVoice = Effect.fn("SettingsRpc.setDefaultVoice")(function*(voiceId: string, wordsPerSecond: number) {
    const preset = yield* presets.getDefault
    const updated = yield* presets.updateConfig(preset.id, {
      ...preset.config,
      voice: { ...preset.config.voice, voiceId, wordsPerSecond }
    })
    return { voiceId: updated.config.voice.voiceId, wordsPerSecond: updated.config.voice.wordsPerSecond }
  })

  return SettingsRpcs.of({
    GetAccounts: () =>
      Effect.all([claude, codexAccount, opencodeAccount, ...KeyName.literals.map(keys.account)], { concurrency: "unbounded" }),
    GetCliModels: () => cliModels,
    ListKeyModels: ({ provider }) => keyModels.list(provider),
    SetSecret: ({ name, value }) => keys.save(name, value),
    TestSecret: ({ name, value }) => keys.test(name, value),
    RemoveSecret: ({ name }) => keys.remove(name),
    GetCliSetups: () => setups.all,
    SetCliPreset: ({ cli, preset }) => setups.setPreset(cli, preset),
    SetCliEnvVar: ({ cli, name, value, secret }) => setups.setVar(cli, name, value, secret),
    RemoveCliEnvVar: ({ cli, name }) => setups.removeVar(cli, name),
    GetSettings: () => store.get,
    SetDefaultAgent: ({ agent }) => store.setDefaultAgent(agent),
    SetStageAgent: ({ stage, agent }) => store.setStageAgent(stage, agent),
    GetModelEvals: () => evals.byModel,
    SetTranscriber: ({ choice }) => store.setTranscriber(choice),
    SetDefaultVoice: ({ voiceId, wordsPerSecond }) => setDefaultVoice(voiceId, wordsPerSecond),
    GetStorage: () => storage.get,
    GetUsage: ({ days }) => usage.get(days),
    GetElevenLabsPlan: () => eleven.plan
  })
}))
