import { type Account, type KeyName, SettingsError, SettingsRpcs } from "@viral/contracts"
import { Effect, Option, Redacted, String as Str } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Presets } from "../presets/presets.ts"
import { Secrets } from "../secrets/secrets.ts"
import { StorageReport } from "../storage/storage.ts"
import { UsageReport } from "../usage/usage.ts"
import { AppSettingsStore } from "./app-settings.ts"

export const SettingsRpcLive = SettingsRpcs.toLayer(Effect.gen(function*() {
  const secrets = yield* Secrets
  const store = yield* AppSettingsStore
  const presets = yield* Presets
  const storage = yield* StorageReport
  const usage = yield* UsageReport
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  // The Claude CLI is usable when it's on the PATH; its version is what we can learn without changing anything.
  const claude = spawner.string(ChildProcess.make("claude", ["--version"])).pipe(
    Effect.map((out): Account => ({ name: "claude", status: "ready", source: "cli", detail: Str.trim(out) || null })),
    Effect.orElseSucceed((): Account => ({ name: "claude", status: "missing", source: null, detail: "The Claude CLI isn't on this Mac's PATH" }))
  )
  const keyAccount = (name: KeyName) =>
    Effect.map(secrets.source(name), (source): Account => ({
      name,
      status: Option.isSome(source) ? "ready" : "missing",
      source: Option.getOrNull(source),
      detail: null
    }))

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
    GetAccounts: () => Effect.all([claude, keyAccount("elevenlabs"), keyAccount("xai")], { concurrency: "unbounded" }),
    SetSecret: ({ name, value }) =>
      secrets.set(name, Redacted.make(value)).pipe(Effect.mapError(keyError), Effect.andThen(keyAccount(name))),
    RemoveSecret: ({ name }) => secrets.remove(name).pipe(Effect.mapError(keyError), Effect.andThen(keyAccount(name))),
    GetSettings: () => store.get,
    SetStageModel: ({ stage, model }) => store.setStageModel(stage, model),
    SetTranscriber: ({ choice }) => store.setTranscriber(choice),
    SetDefaultVoice: ({ voiceId, wordsPerSecond }) => setDefaultVoice(voiceId, wordsPerSecond),
    GetStorage: () => storage.get,
    GetUsage: ({ days }) => usage.get(days)
  })
}))
