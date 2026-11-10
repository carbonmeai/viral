// Formatting for Settings › Usage.
export const formatUsd = (usd: number) =>
  usd === 0 ? "$0" : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`

export const formatCount = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

// Bar heights (0–1) for the daily chart, scaled to the busiest day; an all-zero period draws no bars.
export const barHeights = (values: ReadonlyArray<number>) => {
  const top = Math.max(0, ...values)
  return values.map((v) => (top === 0 ? 0 : v / top))
}

// A short date label, "Nov 6", for a YYYY-MM-DD day.
export const dayLabel = (day: string) => {
  const [, month, date] = day.split("-")
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${names[Number(month) - 1] ?? month} ${Number(date)}`
}

// Names for the providers that ran things.
const PROVIDER_LABELS: Record<string, string> = {
  "claude-cli": "Claude CLI",
  codex: "Codex",
  opencode: "OpenCode",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  "ai-gateway": "AI Gateway",
  elevenlabs: "ElevenLabs",
  unknown: "Before tracking"
}
export const providerLabel = (provider: string | null) => PROVIDER_LABELS[provider ?? "unknown"] ?? provider ?? "Before tracking"

// A model's cost as the page shows it: "price unknown" for a model Viral has no price for (never $0), and "~" before
// a cost estimated from tokens at Viral's prices (Anthropic, OpenAI and Google report tokens, not dollars).
export const modelCostText = (usd: number, basis: "reported" | "estimate" | "unknown" | null) =>
  basis === "unknown" ? (usd > 0 ? `${formatUsd(usd)} + price unknown` : "price unknown") : basis === "estimate" ? `~${formatUsd(usd)}` : formatUsd(usd)

// What a cost is: real money, or what a CLI plan covered.
export const billingLabel = (billing: "billed" | "subscription" | null) =>
  billing === "billed" ? "Billed" : billing === "subscription" ? "Plan value" : "Not tracked"

// A whole number with thousands separators: "41,250".
export const formatExact = (n: number) => Math.round(n).toLocaleString("en-US")

// The ElevenLabs plan's meter: characters used and left this billing period, and how full it is (0–1).
export const planMeter = (used: number, limit: number) => ({
  left: Math.max(0, limit - used),
  fraction: limit <= 0 ? 0 : Math.min(1, used / limit)
})

// What `characters` cost at the plan's price per character; null when the price isn't known, so none is invented.
export const estimateUsd = (characters: number, usdPerCharacter: number | null) =>
  usdPerCharacter === null ? null : Math.round(characters * usdPerCharacter * 100) / 100

// Why the plan can't be shown, in plain words.
export const planUnavailableText = (reason: "no-key" | "no-permission" | "failed") =>
  reason === "no-key"
    ? "Add an ElevenLabs key in Settings › Accounts to see your plan’s characters left."
    : reason === "no-permission"
    ? "To see your plan’s characters left, give your ElevenLabs key the User › Read permission."
    : "Couldn’t reach ElevenLabs for your plan just now."

// "eleven_v4" → "Eleven v4", "eleven_multilingual_v2" → "Eleven Multilingual v2".
export const ttsModelLabel = (model: string) =>
  model === "unknown"
    ? "Before tracking"
    : model.split("_").map((part) => /^v\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
