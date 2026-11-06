import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { PresetNotFound } from "./presets.ts"

// The services Viral talks to. Claude runs through your CLI; ElevenLabs and xAI use API keys.
export const AccountName = Schema.Literals(["claude", "elevenlabs", "xai"])
export type AccountName = typeof AccountName.Type
export const KeyName = Schema.Literals(["elevenlabs", "xai"])
export type KeyName = typeof KeyName.Type

// Whether an account is usable and where its key comes from. A key's value never crosses the wire.
export const Account = Schema.Struct({
  name: AccountName,
  status: Schema.Literals(["ready", "missing"]),
  // environment: a variable set when the server started (wins over the Keychain); keychain: the macOS
  // Keychain entry Viral manages; cli: the Claude CLI
  source: Schema.NullOr(Schema.Literals(["environment", "keychain", "cli"])),
  // e.g. the Claude CLI's version
  detail: Schema.NullOr(Schema.String)
})
export type Account = typeof Account.Type

// The agent stages whose model you can choose.
export const AgentStage = Schema.Literals(["ads", "story", "script", "shots", "metadata"])
export type AgentStage = typeof AgentStage.Type

export const TranscriberChoice = Schema.Literals(["auto", "grok", "whisper-local"])
export type TranscriberChoice = typeof TranscriberChoice.Type

// App preferences the server keeps. A stage's model is null when it uses its default (your CLI's model, or
// Haiku for ads and metadata).
export const AppSettings = Schema.Struct({
  stageModels: Schema.Struct({
    ads: Schema.NullOr(Schema.String),
    story: Schema.NullOr(Schema.String),
    script: Schema.NullOr(Schema.String),
    shots: Schema.NullOr(Schema.String),
    metadata: Schema.NullOr(Schema.String)
  }),
  transcriber: TranscriberChoice,
  // VIRAL_TRANSCRIBER was set when the server started, which overrides the choice above
  transcriberFromEnvironment: Schema.NullOr(Schema.String)
})
export type AppSettings = typeof AppSettings.Type

export const StorageArea = Schema.Struct({
  name: Schema.Literals(["sources", "projects", "renders", "music", "sounds", "references", "voice-previews", "database"]),
  path: Schema.String,
  bytes: Schema.Number
})
export const Storage = Schema.Struct({ root: Schema.String, areas: Schema.Array(StorageArea) })
export type Storage = typeof Storage.Type

// What agents and voices cost over a period, from every stage run.
export const Usage = Schema.Struct({
  days: Schema.Int,
  totals: Schema.Struct({
    costUsd: Schema.Number,
    ttsCharacters: Schema.Int,
    inputTokens: Schema.Int,
    outputTokens: Schema.Int,
    // shorts with a render in the period, and what an average one cost (all its stage runs in the period)
    shorts: Schema.Int,
    costPerShortUsd: Schema.NullOr(Schema.Number)
  }),
  // one entry per day in the period, oldest first, including empty days
  byDay: Schema.Array(Schema.Struct({ day: Schema.String, costUsd: Schema.Number, ttsCharacters: Schema.Int })),
  byShort: Schema.Array(Schema.Struct({
    projectId: Schema.String,
    title: Schema.String,
    costUsd: Schema.Number,
    ttsCharacters: Schema.Int
  })),
  byStage: Schema.Array(Schema.Struct({
    stage: Schema.String,
    // the model that did most of the runs, when it's an agent stage
    model: Schema.NullOr(Schema.String),
    runs: Schema.Int,
    costUsd: Schema.Number,
    ttsCharacters: Schema.Int
  }))
})
export type Usage = typeof Usage.Type

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  message: Schema.String
}) {}

export class SettingsRpcs extends RpcGroup.make(
  Rpc.make("GetAccounts", { success: Schema.Array(Account) }),
  // Saves a key in the macOS Keychain. The value is only ever sent this way, never returned.
  Rpc.make("SetSecret", { payload: { name: KeyName, value: Schema.String }, success: Account, error: SettingsError }),
  Rpc.make("RemoveSecret", { payload: { name: KeyName }, success: Account, error: SettingsError }),
  Rpc.make("GetSettings", { success: AppSettings }),
  // null goes back to the stage's default model
  Rpc.make("SetStageModel", { payload: { stage: AgentStage, model: Schema.NullOr(Schema.String) }, success: AppSettings }),
  Rpc.make("SetTranscriber", { payload: { choice: TranscriberChoice }, success: AppSettings }),
  // The default style's voice and pace, used by every short that doesn't pick its own voice.
  Rpc.make("SetDefaultVoice", {
    payload: { voiceId: Schema.String, wordsPerSecond: Schema.Finite },
    success: Schema.Struct({ voiceId: Schema.String, wordsPerSecond: Schema.Finite }),
    error: PresetNotFound
  }),
  Rpc.make("GetStorage", { success: Storage }),
  Rpc.make("GetUsage", { payload: { days: Schema.Int }, success: Usage })
) {}
