import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { PresetNotFound } from "./presets.ts"

// The services Viral talks to. Claude, Codex and OpenCode run through their CLIs, signed in as you; ElevenLabs,
// xAI and the AI Gateway use API keys. The AI Gateway runs agent steps on other models (Haiku, GPT-6 Luna, Gemini…).
export const AccountName = Schema.Literals(["claude", "codex", "opencode", "elevenlabs", "xai", "gateway"])
export type AccountName = typeof AccountName.Type
export const KeyName = Schema.Literals(["elevenlabs", "xai", "gateway"])
export type KeyName = typeof KeyName.Type

// Whether an account is usable and where its key comes from. A key's value never crosses the wire. A CLI can also
// be installed but signed out, or too old for Viral (OpenCode before 2.2.6).
export const Account = Schema.Struct({
  name: AccountName,
  status: Schema.Literals(["ready", "missing", "signed-out", "outdated"]),
  // environment: a variable set when the server started (wins over the Keychain); keychain: the macOS
  // Keychain entry Viral manages; cli: an installed CLI
  source: Schema.NullOr(Schema.Literals(["environment", "keychain", "cli"])),
  // e.g. the Claude CLI's version, or how Codex is signed in
  detail: Schema.NullOr(Schema.String),
  // a CLI's version ("0.154.0")
  version: Schema.NullOr(Schema.String),
  // what to do before Viral can use it: how to install, sign in or update (Viral never does it for you)
  hint: Schema.NullOr(Schema.String)
})
export type Account = typeof Account.Type

// The agent stages whose model you can choose.
export const AgentStage = Schema.Literals(["research", "ads", "story", "set-story", "script", "shots", "sections", "moments", "metadata", "thumbnail"])
export type AgentStage = typeof AgentStage.Type

// Who runs an agent stage. The Claude CLI is the out-of-the-box default; Codex runs on your ChatGPT plan (or OpenAI
// key); OpenCode on the providers you've signed in to there; the AI Gateway runs other models (Haiku, GPT-6 Luna,
// Gemini…) on your gateway key.
export const AgentProvider = Schema.Literals(["claude-cli", "codex", "opencode", "ai-gateway"])
export type AgentProvider = typeof AgentProvider.Type

// Whether a cost is real money (an API key, the gateway) or the API-equivalent value a CLI plan reports.
export const CostBilling = Schema.Literals(["billed", "subscription"])
export type CostBilling = typeof CostBilling.Type

// Stages that look at images (contact sheets, previews).
export const VISION_STAGES: ReadonlyArray<AgentStage> = ["shots", "sections", "moments", "thumbnail"]

// Providers checked to see images in a stage (the files it reads and its tools' results). Vision stages run only on
// these; the others fall back to the Claude CLI there.
export const VISION_PROVIDERS: ReadonlyArray<AgentProvider> = ["claude-cli"]

// A model a CLI offers on your account (Codex's catalog, `opencode models`).
export const CliModel = Schema.Struct({ id: Schema.String, label: Schema.String })
export type CliModel = typeof CliModel.Type
export const CliModels = Schema.Struct({
  provider: Schema.Literals(["codex", "opencode"]),
  models: Schema.Array(CliModel)
})
export type CliModels = typeof CliModels.Type

// The Claude CLI's model choices; null is your CLI's own default (or the stage's, e.g. Haiku for ads).
export const CLI_MODELS: ReadonlyArray<{ readonly id: string | null; readonly label: string }> = [
  { id: null, label: "CLI default" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" }
]

// The gateway models offered in Settings › Agents (any other gateway id can be typed in).
export const GATEWAY_MODELS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna" },
  { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" }
]

// A provider and the model on it. A null model means the CLI's (or the stage's) default; on the gateway a model
// must be chosen.
export const AgentChoice = Schema.Struct({ provider: AgentProvider, model: Schema.NullOr(Schema.String) })
export type AgentChoice = typeof AgentChoice.Type

// What actually runs a stage: its own choice, or the default for all steps. `inherited` is true when the stage
// uses the default; `forcedCli` when the choice can't see images but the stage needs to, so the Claude CLI runs it.
export const AgentRoute = Schema.Struct({
  provider: AgentProvider,
  model: Schema.NullOr(Schema.String),
  inherited: Schema.Boolean,
  forcedCli: Schema.Boolean
})
export type AgentRoute = typeof AgentRoute.Type

// Whether a provider can run a stage: vision stages need one of VISION_PROVIDERS.
export const canRunStage = (provider: AgentProvider, stage: AgentStage) =>
  !VISION_STAGES.includes(stage) || VISION_PROVIDERS.includes(provider)

// One rule for every client and the server: a stage's own choice wins, then the default for all steps; a stage
// that needs vision runs on the Claude CLI (on its own default model) when the choice can't see images.
export const resolveAgentRoute = (
  stage: AgentStage,
  defaultAgent: AgentChoice,
  own: AgentChoice | null
): AgentRoute => {
  const choice = own ?? defaultAgent
  const forced = !canRunStage(choice.provider, stage)
  return forced
    ? { provider: "claude-cli", model: null, inherited: own === null, forcedCli: true }
    : { provider: choice.provider, model: choice.model, inherited: own === null, forcedCli: false }
}

const perStage = <S extends Schema.Top>(value: S) =>
  Schema.Struct({
    research: value,
    ads: value,
    story: value,
    "set-story": value,
    script: value,
    shots: value,
    sections: value,
    moments: value,
    metadata: value,
    thumbnail: value
  })

export const TranscriberChoice = Schema.Literals(["auto", "grok", "whisper-local"])
export type TranscriberChoice = typeof TranscriberChoice.Type

// App preferences the server keeps.
export const AppSettings = Schema.Struct({
  // what runs every agent step unless the step has its own choice; the Claude CLI out of the box
  defaultAgent: AgentChoice,
  // a step's own choice, or null to use the default
  stageAgents: perStage(Schema.NullOr(AgentChoice)),
  // what each step will actually run on (resolveAgentRoute over the two above)
  routes: perStage(AgentRoute),
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
  })),
  // real money vs the value of a CLI plan, from the pipeline's stage runs (not evals)
  billing: Schema.Struct({ billedUsd: Schema.Number, subscriptionUsd: Schema.Number, unknownUsd: Schema.Number }),
  byProvider: Schema.Array(Schema.Struct({
    provider: Schema.String,
    billing: Schema.NullOr(CostBilling),
    runs: Schema.Int,
    costUsd: Schema.Number,
    ttsCharacters: Schema.Int
  })),
  byModel: Schema.Array(Schema.Struct({
    model: Schema.String,
    provider: Schema.NullOr(Schema.String),
    runs: Schema.Int,
    costUsd: Schema.Number,
    inputTokens: Schema.Int,
    outputTokens: Schema.Int
  })),
  // ElevenLabs characters in the period: the voice stage's takes plus "Try a line" previews (which belong to no
  // short). Characters, not dollars: a plan's price is only known from GetElevenLabsPlan.
  elevenLabs: Schema.Struct({
    characters: Schema.Int,
    takes: Schema.Int,
    previews: Schema.Int,
    previewCharacters: Schema.Int,
    // one entry per day in the period, oldest first, including empty days
    byDay: Schema.Array(Schema.Struct({ day: Schema.String, characters: Schema.Int })),
    byModel: Schema.Array(Schema.Struct({ model: Schema.String, characters: Schema.Int, takes: Schema.Int, previews: Schema.Int })),
    byShort: Schema.Array(Schema.Struct({ projectId: Schema.String, title: Schema.String, characters: Schema.Int, takes: Schema.Int }))
  }),
  // what model evals spent in the period, kept apart from making shorts
  evals: Schema.Struct({
    costUsd: Schema.Number,
    billedUsd: Schema.Number,
    subscriptionUsd: Schema.Number,
    runs: Schema.Int,
    byModel: Schema.Array(Schema.Struct({
      model: Schema.String,
      provider: Schema.String,
      runs: Schema.Int,
      costUsd: Schema.Number
    }))
  })
})
export type Usage = typeof Usage.Type

// Your ElevenLabs plan's characters this billing period, read from ElevenLabs (cached for a minute). Unavailable
// without a key, when the key lacks the User read permission, or when ElevenLabs can't be reached.
export const ElevenLabsPlan = Schema.Union([
  Schema.TaggedStruct("Plan", {
    tier: Schema.String,
    charactersUsed: Schema.Int,
    characterLimit: Schema.Int,
    // ISO time the count resets
    resetsAt: Schema.NullOr(Schema.String),
    // the plan's price per character, from its next invoice in USD; null when the price isn't known
    usdPerCharacter: Schema.NullOr(Schema.Number),
    checkedAt: Schema.String
  }),
  Schema.TaggedStruct("Unavailable", {
    reason: Schema.Literals(["no-key", "no-permission", "failed"]),
    message: Schema.String
  })
])
export type ElevenLabsPlan = typeof ElevenLabsPlan.Type

// A model's record across your evals.
export const ModelEval = Schema.Struct({
  model: Schema.String,
  provider: AgentProvider,
  runs: Schema.Int,
  passed: Schema.Int,
  firstTryPassed: Schema.Int,
  avgCostUsd: Schema.Number,
  stages: Schema.Array(Schema.String),
  lastRunAt: Schema.String
})
export type ModelEval = typeof ModelEval.Type

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  message: Schema.String
}) {}

export class SettingsRpcs extends RpcGroup.make(
  Rpc.make("GetAccounts", { success: Schema.Array(Account) }),
  // the models Codex and OpenCode offer on your account (empty for one that isn't installed or signed in)
  Rpc.make("GetCliModels", { success: Schema.Array(CliModels) }),
  // Saves a key in the macOS Keychain. The value is only ever sent this way, never returned.
  Rpc.make("SetSecret", { payload: { name: KeyName, value: Schema.String }, success: Account, error: SettingsError }),
  Rpc.make("RemoveSecret", { payload: { name: KeyName }, success: Account, error: SettingsError }),
  Rpc.make("GetSettings", { success: AppSettings }),
  // The provider and model for every step that hasn't got its own. The gateway needs a model and its key.
  Rpc.make("SetDefaultAgent", { payload: { agent: AgentChoice }, success: AppSettings, error: SettingsError }),
  // A step's own provider and model, or null to use the default. Vision steps can't move to the gateway yet.
  Rpc.make("SetStageAgent", {
    payload: { stage: AgentStage, agent: Schema.NullOr(AgentChoice) },
    success: AppSettings,
    error: SettingsError
  }),
  // How each model did in your evals (cli eval), for choosing one: runs, passes and average cost per step.
  Rpc.make("GetModelEvals", { success: Schema.Array(ModelEval) }),
  Rpc.make("SetTranscriber", { payload: { choice: TranscriberChoice }, success: AppSettings }),
  // The default style's voice and pace, used by every short that doesn't pick its own voice.
  Rpc.make("SetDefaultVoice", {
    payload: { voiceId: Schema.String, wordsPerSecond: Schema.Finite },
    success: Schema.Struct({ voiceId: Schema.String, wordsPerSecond: Schema.Finite }),
    error: PresetNotFound
  }),
  Rpc.make("GetStorage", { success: Storage }),
  Rpc.make("GetUsage", { payload: { days: Schema.Int }, success: Usage }),
  Rpc.make("GetElevenLabsPlan", { success: ElevenLabsPlan })
) {}
