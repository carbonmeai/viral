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
