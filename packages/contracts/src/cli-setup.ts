import { Schema } from "effect"
import type { AgentProvider, KeyName } from "./settings.ts"

// The signed-in apps Viral runs (Settings › Accounts names), and the agent provider each one is.
export const CliName = Schema.Literals(["claude", "codex", "opencode"])
export type CliName = typeof CliName.Type
export const CLI_PROVIDER = { claude: "claude-cli", codex: "codex", opencode: "opencode" } as const satisfies Record<CliName, AgentProvider>

// One-click ways to run a CLI on a key you saved in Model keys instead of your sign-in. Each CLI takes at most one.
//   claude-openrouter: the Claude CLI through OpenRouter (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN, an empty
//     ANTHROPIC_API_KEY), in its own config folder so your normal Claude login isn't touched and can't clash
//   claude-anthropic: the Claude CLI on your Anthropic key (ANTHROPIC_API_KEY), paying per use instead of your plan
//   codex-openai: Codex signed in with your OpenAI key, in its own folder (the key is kept in memory only)
//   opencode-keys: your Anthropic, OpenAI, Google and OpenRouter keys handed to OpenCode for its runs
export const CliPreset = Schema.Literals(["claude-openrouter", "claude-anthropic", "codex-openai", "opencode-keys"])
export type CliPreset = typeof CliPreset.Type

export interface CliPresetInfo {
  readonly cli: CliName
  readonly label: string
  // the saved keys it uses: all of them must be there (opencode-keys: any of them)
  readonly keys: ReadonlyArray<KeyName>
  // runs on it spend real money
  readonly billed: boolean
}

export const CLI_PRESETS: Record<CliPreset, CliPresetInfo> = {
  "claude-openrouter": { cli: "claude", label: "OpenRouter key", keys: ["openrouter"], billed: true },
  "claude-anthropic": { cli: "claude", label: "Anthropic key", keys: ["anthropic"], billed: true },
  "codex-openai": { cli: "codex", label: "OpenAI key", keys: ["openai"], billed: true },
  "opencode-keys": { cli: "opencode", label: "Your model keys", keys: ["anthropic", "openai", "google", "openrouter"], billed: true }
}

export const presetsFor = (cli: CliName): ReadonlyArray<CliPreset> =>
  CliPreset.literals.filter((preset) => CLI_PRESETS[preset].cli === cli)

// OpenRouter's Anthropic-compatible address, for the Claude CLI
export const OPENROUTER_ANTHROPIC_URL = "https://openrouter.ai/api"

// An extra environment variable for a CLI. A secret's value is kept in the secret store (the macOS Keychain) and
// never comes back: only its last four characters, when it's long enough.
export const CliEnvVar = Schema.Struct({
  name: Schema.String,
  // a plain value; null for a secret
  value: Schema.NullOr(Schema.String),
  secret: Schema.Boolean,
  last4: Schema.NullOr(Schema.String)
})
export type CliEnvVar = typeof CliEnvVar.Type

// A CLI's key setup as Settings shows it.
export const CliSetup = Schema.Struct({
  cli: CliName,
  preset: Schema.NullOr(CliPreset),
  // what the preset sets, in words: { name: "ANTHROPIC_AUTH_TOKEN", value: "your OpenRouter key …a1F9" }
  presetVars: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
  // your own variables, in the order you added them (the preset's win over them)
  env: Schema.Array(CliEnvVar),
  // the CLI's own config folder for this setup, when it has one
  configDir: Schema.NullOr(Schema.String),
  // what its runs count as in Usage
  billing: Schema.Literals(["billed", "subscription"]),
  // "Using your OpenRouter key", or null when it runs on your sign-in
  using: Schema.NullOr(Schema.String),
  // why a run would fail right now, in plain words ("Add your OpenRouter key in Model keys first.")
  problem: Schema.NullOr(Schema.String)
})
export type CliSetup = typeof CliSetup.Type

// Variable names: letters, digits and underscores, not starting with a digit.
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_NAME = 128

// Names a CLI's environment may not set, because they'd change how the process itself starts or where it keeps its
// things, or because Viral sets them for its own runs.
const BLOCKED_NAMES = new Set(["PATH", "HOME", "USER", "SHELL", "TMPDIR", "NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE", "CODEX_HOME"])
const BLOCKED_PREFIXES = ["DYLD_", "LD_", "VIRAL_", "OPENCODE_"]

// Why a name can't be used, in plain words; null when it can.
export const envNameProblem = (name: string): string | null => {
  if (name === "") return "Give the variable a name."
  if (name.length > MAX_NAME || !ENV_NAME.test(name)) return "A variable name can only have letters, digits and underscores, and can't start with a digit."
  const upper = name.toUpperCase()
  if (BLOCKED_NAMES.has(upper)) return `${name} can't be set here: it changes how the app itself starts or where it keeps its files.`
  const prefix = BLOCKED_PREFIXES.find((p) => upper.startsWith(p))
  if (prefix === "VIRAL_" || prefix === "OPENCODE_") return `${name} can't be set here: Viral sets ${prefix}* variables for its own runs.`
  if (prefix !== undefined) return `${name} can't be set here: ${prefix}* variables change how programs load, which isn't safe.`
  return null
}
