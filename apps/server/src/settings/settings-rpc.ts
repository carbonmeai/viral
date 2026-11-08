import { type Account, type CliModels, type KeyName, SettingsError, SettingsRpcs } from "@viral/contracts"
import { codexStatus } from "@viral/provider-codex"
import { MIN_OPENCODE_VERSION, opencodeStatus, updateHint } from "@viral/provider-opencode"
import { Effect, Option, Redacted, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Presets } from "../presets/presets.ts"
import { Secrets } from "../secrets/secrets.ts"
import { StorageReport } from "../storage/storage.ts"
import { EvalRecords } from "../eval/eval-records.ts"
import { UsageReport } from "../usage/usage.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { AppSettingsStore } from "./app-settings.ts"

export const SettingsRpcLive = SettingsRpcs.toLayer(Effect.gen(function*() {
  const secrets = yield* Secrets
  const store = yield* AppSettingsStore
  const presets = yield* Presets
  const storage = yield* StorageReport
  const usage = yield* UsageReport
  const evals = yield* EvalRecords
  const eleven = yield* ElevenLabs
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  // The Claude CLI is usable when it's on the PATH; its version is what we can learn without changing anything.
  const claude = spawner.string(ChildProcess.make("claude", ["--version"])).pipe(
    Effect.map((out): Account => ({ name: "claude", status: "ready", source: "cli", detail: Str.trim(out) || null, version: Str.trim(out).split(" ")[0] ?? null, hint: null })),
    Effect.orElseSucceed((): Account => ({ name: "claude", status: "missing", source: null, detail: "The Claude CLI isn't on this Mac's PATH", version: null, hint: null }))
  )
  const keyAccount = (name: KeyName) =>
    Effect.map(secrets.source(name), (source): Account => ({
      name,
      status: Option.isSome(source) ? "ready" : "missing",
      source: Option.getOrNull(source),
      detail: null,
      version: null,
      hint: null
    }))

  // Codex and OpenCode each take a second or two to ask (Codex starts an app-server), so their answers are kept
  // for a minute; Accounts and the model pickers share them.
  const codex = yield* Effect.cachedWithTTL(codexStatus(), "1 minute")
  const opencode = yield* Effect.cachedWithTTL(opencodeStatus(), "1 minute")
  const codexAccount = Effect.map(codex, (status): Account => {
    const version = Option.getOrNull(status.version)?.replace(/^codex-cli\s+/, "") ?? null
    if (version === null) {
      return { name: "codex", status: "missing", source: null, detail: null, version, hint: "Install the Codex CLI (npm i -g @openai/codex), then sign in." }
    }
    return Option.match(status.account, {
      onNone: (): Account => ({ name: "codex", status: "signed-out", source: "cli", detail: null, version, hint: "Run `codex login` in Terminal." }),
      onSome: (account): Account => ({
        name: "codex",
        status: "ready",
        source: "cli",
        detail: account.type === "chatgpt" ? `ChatGPT${account.plan === null ? "" : ` (${account.plan})`}` : "OpenAI API key",
        version,
        hint: null
      })
    })
  })
  const opencodeAccount = Effect.map(opencode, (status): Account => {
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
  })
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

  const keyError = (error: { readonly message: string }) => new SettingsError({ message: error.message })

  return SettingsRpcs.of({
    GetAccounts: () =>
      Effect.all([claude, codexAccount, opencodeAccount, keyAccount("elevenlabs"), keyAccount("xai"), keyAccount("gateway")], {
        concurrency: "unbounded"
      }),
    GetCliModels: () => cliModels,
    SetSecret: ({ name, value }) =>
      secrets.set(name, Redacted.make(value)).pipe(Effect.mapError(keyError), Effect.andThen(keyAccount(name))),
    RemoveSecret: ({ name }) => secrets.remove(name).pipe(Effect.mapError(keyError), Effect.andThen(keyAccount(name))),
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
