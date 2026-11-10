import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { KeyProvider } from "./model-catalog.ts"
import { PresetNotFound } from "./presets.ts"

// The services Viral talks to. Claude, Codex and OpenCode run through their CLIs, signed in as you; the rest use API
// keys: model keys (Anthropic, OpenAI, Google Gemini, OpenRouter, the AI Gateway), which run agent steps on their
// models, and voice and transcription keys (ElevenLabs, xAI).
export const AccountName = Schema.Literals([
  "claude",
  "codex",
  "opencode",
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "gateway",
  "elevenlabs",
  "xai"
])
export type AccountName = typeof AccountName.Type
export const KeyName = Schema.Literals(["anthropic", "openai", "google", "openrouter", "gateway", "elevenlabs", "xai"])
export type KeyName = typeof KeyName.Type
export const MODEL_KEYS: ReadonlyArray<KeyName> = ["anthropic", "openai", "google", "openrouter", "gateway"]
export const VOICE_KEYS: ReadonlyArray<KeyName> = ["elevenlabs", "xai"]

// What one free call to a service said about a key (listing its models or reading the key's own info; no tokens
// are spent). ok: it works; refused: wrong, revoked or blocked; no-credit: it works but has nothing left to spend
// (only services that report credit); unreachable: the service couldn't be reached (a network problem, a timeout
// or the service failing), which says nothing about the key; unknown: an answer Viral didn't expect.
export const KeyCheckCode = Schema.Literals(["ok", "refused", "no-credit", "unreachable", "unknown"])
export type KeyCheckCode = typeof KeyCheckCode.Type
export const KeyCheck = Schema.Struct({
  code: KeyCheckCode,
  // in plain words: "Works. 63 models available."
  message: Schema.String,
  // how many models the key can use, when the service lists them
  models: Schema.NullOr(Schema.Int),
  // ISO time of the check
  checkedAt: Schema.String
})
export type KeyCheck = typeof KeyCheck.Type

// Whether an account is usable and where its key comes from. A key's value never crosses the wire, only its last
// four characters. A CLI can also be installed but signed out, or too old for Viral (OpenCode before 2.2.6).
export const Account = Schema.Struct({
  name: AccountName,
  status: Schema.Literals(["ready", "missing", "signed-out", "outdated"]),
  // environment: a variable set when the server started (wins over the saved key); keychain: the key saved in
  // Settings (in the macOS Keychain); cli: an installed CLI
  source: Schema.NullOr(Schema.Literals(["environment", "keychain", "cli"])),
  // e.g. the Claude CLI's version, or how Codex is signed in
  detail: Schema.NullOr(Schema.String),
  // a CLI's version ("0.154.0")
  version: Schema.NullOr(Schema.String),
  // what to do before Viral can use it: how to install, sign in or update (Viral never does it for you)
  hint: Schema.NullOr(Schema.String),
  // a key's environment variable when the key comes from it ("ANTHROPIC_API_KEY")
  envVar: Schema.NullOr(Schema.String),
  // the key's last four characters, never more ("a1F9"); null for a CLI, no key, or a key too short to show any
  last4: Schema.NullOr(Schema.String),
  // the last Test of the key in use (kept in settings, never with the key)
  check: Schema.NullOr(KeyCheck)
})
export type Account = typeof Account.Type

// A key that was checked and saved: unreachable services still save, with the check saying so.
export const SecretSaved = Schema.Struct({ account: Account, check: KeyCheck })
export type SecretSaved = typeof SecretSaved.Type

// The agent stages whose model you can choose.
export const AgentStage = Schema.Literals(["research", "ads", "story", "set-story", "script", "shots", "sections", "moments", "metadata", "thumbnail"])
export type AgentStage = typeof AgentStage.Type

// Who runs an agent stage. The Claude CLI is the out-of-the-box default; Codex runs on your ChatGPT plan (or OpenAI
// key); OpenCode on the providers you've signed in to there. The rest run on your own API keys through the AI SDK,
// each with its vendor's model ids: Anthropic, OpenAI, Google (Gemini), OpenRouter, and the AI Gateway (one key for
// many vendors' models).
export const AgentProvider = Schema.Literals(["claude-cli", "codex", "opencode", "anthropic", "openai", "google", "openrouter", "ai-gateway"])
export type AgentProvider = typeof AgentProvider.Type

// Whether a cost is real money (an API key, the gateway) or the API-equivalent value a CLI plan reports.
export const CostBilling = Schema.Literals(["billed", "subscription"])
export type CostBilling = typeof CostBilling.Type

// Where a recorded cost comes from: reported by the service (the AI Gateway, OpenRouter, a CLI); an estimate from
// the tokens at Viral's price table (Anthropic, OpenAI and Google report tokens, not dollars); or unknown (a model
// Viral has no price for: its tokens are kept, its cost isn't guessed). Null on runs recorded before this existed,
// which were all reported.
export const CostBasis = Schema.Literals(["reported", "estimate", "unknown"])
export type CostBasis = typeof CostBasis.Type

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

// A model a key can use, from the vendor's own list (ListKeyModels). `vision`: whether the vendor says it takes
// images (null when its list doesn't say).
export const KeyModel = Schema.Struct({ id: Schema.String, label: Schema.String, vision: Schema.NullOr(Schema.Boolean) })
export type KeyModel = typeof KeyModel.Type
export const KeyModels = Schema.Struct({
  provider: KeyProvider,
  // the key's models that can call tools (an agent step needs them); empty without a key or when listing failed
  models: Schema.Array(KeyModel),
  // why there's no list, in plain words ("Add a key in Accounts", "Couldn't reach OpenAI")
  problem: Schema.NullOr(Schema.String),
  // ISO time the list was read from the vendor (lists are kept for a day)
  fetchedAt: Schema.NullOr(Schema.String)
})
export type KeyModels = typeof KeyModels.Type

// A provider and the model on it. A null model means the CLI's (or the stage's) default; on a key provider (and
// OpenCode) a model must be chosen.
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
    costPerShortUsd: Schema.NullOr(Schema.Number),
    // the part of costUsd estimated from tokens at Viral's prices (Anthropic, OpenAI and Google report no dollars)
    estimatedUsd: Schema.Number,
    // billed agent runs on a model Viral has no price for: their tokens count, their cost doesn't
    unpricedRuns: Schema.Int
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
    outputTokens: Schema.Int,
    // reported, an estimate (any run estimated), or unknown (any run without a price)
    costBasis: Schema.NullOr(CostBasis)
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
  // estimate: some runs' cost came from Viral's price table; unknown: some had no price (their cost counts as 0)
  costBasis: Schema.NullOr(CostBasis),
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
  // the models a key provider's key can use, from the vendor's own list (kept for a day); never fails, a missing
  // key or an unreachable vendor comes back as `problem`
  Rpc.make("ListKeyModels", { payload: { provider: KeyProvider }, success: KeyModels }),
  // Checks a key with one free call to its service, then saves it (the macOS Keychain today). A refused key isn't
  // saved; an unreachable service saves it anyway, with the check saying so. Refused while the key's environment
  // variable is set (it would be ignored). The value is only ever sent this way, never returned.
  Rpc.make("SetSecret", { payload: { name: KeyName, value: Schema.String }, success: SecretSaved, error: SettingsError }),
  // Checks a key without saving it: a pasted value, or (value null) the key in use, saved or from the environment,
  // whose result is kept for Accounts.
  Rpc.make("TestSecret", { payload: { name: KeyName, value: Schema.NullOr(Schema.String) }, success: KeyCheck, error: SettingsError }),
  Rpc.make("RemoveSecret", { payload: { name: KeyName }, success: Account, error: SettingsError }),
  Rpc.make("GetSettings", { success: AppSettings }),
  // The provider and model for every step that hasn't got its own. A key provider needs a model.
  Rpc.make("SetDefaultAgent", { payload: { agent: AgentChoice }, success: AppSettings, error: SettingsError }),
  // A step's own provider and model, or null to use the default. Vision steps stay on the Claude CLI for now.
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
