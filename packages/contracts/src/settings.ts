import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { PresetNotFound } from "./presets.ts"

// The services Viral talks to. Claude runs through your CLI; ElevenLabs, xAI and the AI Gateway use API keys.
// The AI Gateway is experimental: it runs agent stages on other models, for evals.
export const AccountName = Schema.Literals(["claude", "elevenlabs", "xai", "gateway"])
export type AccountName = typeof AccountName.Type
export const KeyName = Schema.Literals(["elevenlabs", "xai", "gateway"])
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
export const AgentStage = Schema.Literals(["ads", "story", "script", "shots", "sections", "metadata", "thumbnail"])
export type AgentStage = typeof AgentStage.Type

// Who runs an agent stage. The Claude CLI is every stage's default; the AI Gateway is experimental, for trying
// other models (evals).
export const AgentProvider = Schema.Literals(["claude-cli", "ai-gateway"])
export type AgentProvider = typeof AgentProvider.Type

// The gateway models offered in Settings › Agents (any other gateway id can be typed in).
export const GATEWAY_MODELS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5" },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
  { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" }
]

const perStage = <S extends Schema.Top>(value: S) =>
  Schema.Struct({
    ads: value,
    story: value,
    script: value,
    shots: value,
    sections: value,
    metadata: value,
    thumbnail: value
  })

export const TranscriberChoice = Schema.Literals(["auto", "grok", "whisper-local"])
export type TranscriberChoice = typeof TranscriberChoice.Type

// App preferences the server keeps. A stage's model is null when it uses its default (your CLI's model, or
// Haiku for ads and metadata).
export const AppSettings = Schema.Struct({
  stageModels: perStage(Schema.NullOr(Schema.String)),
  // claude-cli unless you switched a stage to the experimental AI Gateway
  stageProviders: perStage(AgentProvider),
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
  // Switches a stage between the Claude CLI and the experimental AI Gateway, with the model to use there (a
  // gateway id; null for the CLI's default).
  Rpc.make("SetStageProvider", {
    payload: { stage: AgentStage, provider: AgentProvider, model: Schema.NullOr(Schema.String) },
    success: AppSettings
  }),
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
