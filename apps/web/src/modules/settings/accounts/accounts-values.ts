import { CLI_PRESETS, type CliEnvVar, type CliName, type CliPreset, type CliSetup, presetsFor } from "@viral/contracts"
import type { Account, KeyCheck } from "@viral/contracts"
import { ago } from "../../../lib/format.ts"

// What each key is for, in one line, as Settings › Accounts shows it.
export const KEY_ABOUT = {
  anthropic: { label: "Anthropic", sub: "Claude models on your Anthropic account. Billed by Anthropic." },
  openai: { label: "OpenAI", sub: "GPT models on your OpenAI account." },
  google: { label: "Google Gemini", sub: "Gemini models. On Google’s free tier your prompts may be used to improve Google’s products." },
  openrouter: { label: "OpenRouter", sub: "One key for hundreds of models, billed by OpenRouter." },
  gateway: { label: "AI Gateway", sub: "One key for many models, billed by Vercel. Runs agent steps today (Settings › Agents)." },
  elevenlabs: { label: "ElevenLabs", sub: "Voiceovers and voice samples." },
  xai: { label: "xAI", sub: "Grok transcription. Without it, Viral transcribes on this Mac with Whisper." }
} as const satisfies Record<string, { readonly label: string; readonly sub: string }>

export type Tone = "ok" | "wait" | "neutral"

// A key row's state: the chip, the lines under the label, and which buttons work.
export interface KeyRowState {
  readonly chip: { readonly tone: Tone; readonly text: string }
  readonly lines: ReadonlyArray<{ readonly text: string; readonly tone: "muted" | "warn" }>
  // false while an environment variable supplies the key (a saved one would be ignored)
  readonly canChange: boolean
  readonly canRemove: boolean
  readonly canTest: boolean
}

const problem = (check: KeyCheck | null) => check !== null && check.code !== "ok"

// "…a1F9", or "" for a key too short to show any of it
export const keyTail = (account: Account) => account.last4 === null ? "" : ` …${account.last4}`

export const keyRowState = (account: Account, sub: string, detailed: boolean, now: number): KeyRowState => {
  const check = account.check
  const fromEnv = account.source === "environment"
  const saved = account.source === "keychain"
  const chip = account.status !== "ready"
    ? { tone: "neutral" as const, text: "Not set" }
    : check?.code === "refused"
    ? { tone: "wait" as const, text: "Key refused" }
    : check?.code === "no-credit"
    ? { tone: "wait" as const, text: "No credit" }
    : { tone: "ok" as const, text: fromEnv ? `From ${account.envVar ?? "the environment"}` : `Saved${keyTail(account)}` }

  const lines: Array<KeyRowState["lines"][number]> = [{ text: sub, tone: "muted" }]
  if (fromEnv) {
    lines.push({ text: `From the environment (${account.envVar ?? "a variable"}${keyTail(account)}). A key saved here is ignored while it’s set.`, tone: "muted" })
  }
  // problems always show; a good check only in Detailed
  if (check !== null && (detailed || problem(check))) {
    lines.push({ text: `Checked ${ago(Date.parse(check.checkedAt), now)}: ${check.message}`, tone: problem(check) ? "warn" : "muted" })
  }
  return { chip, lines, canChange: !fromEnv, canRemove: saved, canTest: account.status === "ready" }
}

// "Runs on" for a CLI: your sign-in, or one of its presets. "signin" stands for no preset.
export type RunsOn = CliPreset | "signin"
export const runsOnOptions = (cli: CliName, setup: CliSetup | undefined, keysSaved: ReadonlySet<string>) => [
  { value: "signin" as RunsOn, label: "Your sign-in" },
  ...presetsFor(cli).map((preset) => {
    const missing = CLI_PRESETS[preset].keys.filter((key) => !keysSaved.has(key))
    // a preset whose key isn't saved can't be picked, unless it's already the one in use (so it can be seen)
    const blocked = missing.length > 0 && setup?.preset !== preset
    return {
      value: preset as RunsOn,
      label: `Your ${CLI_PRESETS[preset].label}`,
      ...(blocked ? { disabled: true, note: "Add the key below first" } : {}),
      description: PRESET_ABOUT[preset]
    }
  })
]

// What each preset does, in one line.
export const PRESET_ABOUT: Record<CliPreset, string> = {
  "claude-openrouter": "Through OpenRouter, billed there. Uses its own config folder, so your Claude login isn’t touched.",
  "claude-anthropic": "Pay per use on your Anthropic account instead of your Claude plan.",
  "codex-openai": "Pay per use on your OpenAI account instead of your ChatGPT sign-in. The key stays in memory.",
  "opencode-keys": "Hands your Anthropic, OpenAI, Google and OpenRouter keys to OpenCode for its runs."
}

// How a variable's value shows: a plain value as it is (empty says so), a secret as dots and its last four.
export const envValueText = (v: CliEnvVar) =>
  v.secret ? `••••••${v.last4 === null ? "" : v.last4}` : v.value === "" ? "(empty)" : v.value ?? ""

// The lines under a CLI's row: who bills, a problem, and in Detailed what the preset sets.
export const cliSetupLines = (setup: CliSetup | undefined, detailed: boolean) => {
  if (setup === undefined) return []
  const lines: Array<{ readonly text: string; readonly tone: "muted" | "warn" }> = []
  if (setup.problem !== null) lines.push({ text: setup.problem, tone: "warn" })
  if (setup.preset !== null || setup.env.length > 0) {
    lines.push({ text: setup.billing === "billed" ? "Runs here count as billed in Usage (real money)." : "Runs here count as your plan in Usage.", tone: "muted" })
  }
  return lines
}

// The variables listed under a CLI's row: the preset's (Detailed only, as the setup sets them, not editable) and
// your own. A path in your home folder starts with ~.
export interface EnvLine {
  readonly name: string
  readonly value: string
  readonly secret: boolean
  // set by the preset, not one of yours
  readonly fromSetup: boolean
}
export const envLines = (setup: CliSetup | undefined, detailed: boolean): ReadonlyArray<EnvLine> => {
  if (setup === undefined) return []
  const home = (value: string) => value.replace(/^\/Users\/[^/]+/, "~")
  return [
    ...(detailed ? setup.presetVars.map((v) => ({ name: v.name, value: home(v.value), secret: false, fromSetup: true })) : []),
    ...setup.env.map((v) => ({ name: v.name, value: envValueText(v), secret: v.secret, fromSetup: false }))
  ]
}
