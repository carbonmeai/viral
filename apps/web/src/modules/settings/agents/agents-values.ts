import {
  type AgentChoice,
  type AgentProvider,
  type AgentStage,
  catalogFor,
  catalogModel,
  cheapestFor,
  CLI_MODELS,
  type CliModels,
  isKeyProvider,
  type KeyModels,
  type ModelEval,
  type TokenPrice
} from "@viral/contracts"

const NAMES: Record<AgentProvider, string> = {
  "claude-cli": "Claude CLI",
  codex: "Codex",
  opencode: "OpenCode",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  "ai-gateway": "AI Gateway"
}
export const providerName = (provider: AgentProvider) => NAMES[provider]

// The Provider menu's two groups: apps you're signed in to, then your own API keys.
export const SIGNED_IN: ReadonlyArray<AgentProvider> = ["claude-cli", "codex", "opencode"]
export const API_KEYS: ReadonlyArray<AgentProvider> = ["anthropic", "openai", "google", "openrouter", "ai-gateway"]
export const PROVIDERS: ReadonlyArray<AgentProvider> = [...SIGNED_IN, ...API_KEYS]

// The Accounts row whose readiness makes a provider pickable.
export const ACCOUNT_OF: Record<AgentProvider, string> = {
  "claude-cli": "claude",
  codex: "codex",
  opencode: "opencode",
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  openrouter: "openrouter",
  "ai-gateway": "gateway"
}

// A model as people say it: "CLI default", "Opus", "Claude Haiku 5.5", "GPT-6 Astra", or the id typed in. Codex
// and OpenCode name their models from your account's catalog (`catalog`); key providers from Viral's catalog, then
// the vendor's own list (`live`).
export const modelLabel = (
  provider: AgentProvider,
  model: string | null,
  catalog: ReadonlyArray<CliModels> = [],
  live: ReadonlyArray<KeyModels> = []
) => {
  switch (provider) {
    case "claude-cli":
      return CLI_MODELS.find((m) => m.id === model)?.label ?? model ?? "CLI default"
    case "codex":
      return catalog.find((c) => c.provider === "codex")?.models.find((m) => m.id === model)?.label ?? model ?? "Codex default"
    case "opencode":
      return model ?? "no model chosen"
    case "anthropic":
    case "openai":
    case "google":
    case "openrouter":
    case "ai-gateway":
      return catalogModel(provider, model)?.label ??
        live.find((l) => l.provider === provider)?.models.find((m) => m.id === model)?.label ??
        model ??
        "no model chosen"
  }
}

// How an eval names a model: claude-cli (the step's own CLI model), claude-cli:<model>, codex, codex:<model>,
// opencode:<provider/model>, anthropic:<id> (and openai, google, openrouter), or a bare gateway id.
export const evalKey = (choice: AgentChoice) => {
  switch (choice.provider) {
    case "claude-cli":
    case "codex":
      return choice.model === null ? choice.provider : `${choice.provider}:${choice.model}`
    case "ai-gateway":
      return choice.model ?? ""
    case "opencode":
    case "anthropic":
    case "openai":
    case "google":
    case "openrouter":
      return `${choice.provider}:${choice.model ?? ""}`
  }
}

const withoutPrefix = (key: string, provider: string) => key.startsWith(`${provider}:`) ? key.slice(provider.length + 1) : null

export const evalLabel = (e: ModelEval) => {
  switch (e.provider) {
    case "claude-cli":
      return e.model === "claude-cli" ? "Claude CLI (each step’s default)" : `Claude CLI · ${modelLabel("claude-cli", withoutPrefix(e.model, "claude-cli"))}`
    case "codex":
      return e.model === "codex" ? "Codex (its default model)" : `Codex · ${withoutPrefix(e.model, "codex") ?? e.model}`
    case "opencode":
      return `OpenCode · ${withoutPrefix(e.model, "opencode") ?? e.model}`
    case "ai-gateway":
      return modelLabel("ai-gateway", e.model)
    case "anthropic":
    case "openai":
    case "google":
    case "openrouter":
      return `${providerName(e.provider)} · ${modelLabel(e.provider, withoutPrefix(e.model, e.provider) ?? e.model)}`
  }
}

const usd = (n: number) => n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`

// What an average run cost in your evals: dollars (marked when estimated from tokens), "on your plan" for Codex,
// or "price unknown" for a model Viral has no price for (never $0).
const evalCost = (e: ModelEval) =>
  e.provider === "codex"
    ? "on your plan"
    : e.costBasis === "unknown"
    ? "price unknown"
    : `${usd(e.avgCostUsd)} a run${e.costBasis === "estimate" ? " (estimate)" : ""}`

const findEval = (evals: ReadonlyArray<ModelEval>, choice: AgentChoice) =>
  evals.find((x) => x.provider === choice.provider && x.model === evalKey(choice))

// One line on how a model did in your evals: "Evals: 8/8 passed · 6/8 first try · $0.0048 a run". With no choice,
// the first model's.
export const evalLine = (evals: ReadonlyArray<ModelEval>, choice: AgentChoice | null): string | null => {
  const e = choice === null ? evals[0] : findEval(evals, choice)
  if (e === undefined) return null
  return `Evals: ${e.passed}/${e.runs} passed · ${e.firstTryPassed}/${e.runs} first try · ${evalCost(e)}`
}

// "$0.10 / $0.50 per M": input and output tokens, per million.
const perMillion = (n: number) => n < 1 ? `$${n.toFixed(2)}` : `$${Number.isInteger(n) ? n : n.toFixed(2)}`
export const priceLine = (price: TokenPrice) => `${perMillion(price.input)} / ${perMillion(price.output)} per M`

// A model in the picker: its label, a line with the description and badges, and what it costs (an average run in
// your evals, else the price per million tokens).
export interface ModelOption {
  readonly value: string
  readonly label: string
  readonly description: string | undefined
  readonly note: string | undefined
  readonly group: string | undefined
}

export type Badge = "Sees images" | "Fast" | "Cheapest" | "Recommended"

// The badges a catalog model wears for a step (null: the default for every step).
export const badgesFor = (provider: AgentProvider, id: string, stage: AgentStage | null): ReadonlyArray<Badge> => {
  const entry = catalogModel(provider, id)
  if (entry === undefined) return []
  const badges: Array<Badge> = []
  if (entry.recommendedFor.includes(stage ?? "default")) badges.push("Recommended")
  if (entry.badges.includes("vision")) badges.push("Sees images")
  if (entry.badges.includes("fast")) badges.push("Fast")
  if (cheapestFor(provider) === id) badges.push("Cheapest")
  return badges
}

// How many models from your key's own list the menu offers under "More" (OpenRouter lists hundreds); any other id
// can still be typed in.
const MORE_LIMIT = 150

// The models a key provider's picker offers: Viral's curated ones first (description, badges, cost), then the rest of
// what your key lists under "More". A model you picked that's in neither still shows, so the menu tells the truth.
export const keyModelOptions = (
  provider: AgentProvider,
  stage: AgentStage | null,
  live: KeyModels | undefined,
  evals: ReadonlyArray<ModelEval>,
  current: string | null
): ReadonlyArray<ModelOption> => {
  if (!isKeyProvider(provider)) return []
  const curated = catalogFor(provider).map((m): ModelOption => {
    const e = findEval(evals, { provider, model: m.id })
    const badges = badgesFor(provider, m.id, stage)
    return {
      value: m.id,
      label: m.label,
      description: [m.description, ...badges].join(" · "),
      note: e === undefined ? priceLine(m.price) : evalCost(e),
      group: "Suggested"
    }
  })
  const known = new Set(curated.map((m) => m.value))
  const more = (live?.models ?? []).filter((m) => !known.has(m.id)).slice(0, MORE_LIMIT).map((m): ModelOption => {
    const e = findEval(evals, { provider, model: m.id })
    return {
      value: m.id,
      label: m.label === m.id ? m.id : m.label,
      description: m.label === m.id ? (m.vision === true ? "Sees images" : undefined) : [m.id, ...(m.vision === true ? ["Sees images"] : [])].join(" · "),
      note: e === undefined ? undefined : evalCost(e),
      group: "More from your key"
    }
  })
  const listed = new Set([...known, ...more.map((m) => m.value)])
  const chosen = current !== null && !listed.has(current)
    ? [{ value: current, label: current, description: undefined, note: undefined, group: "More from your key" }]
    : []
  return [...curated, ...more, ...chosen]
}

// Who pays for a key provider's runs, in one line for the picker.
export const BILLED_TO: Partial<Record<AgentProvider, string>> = {
  anthropic: "Billed to your Anthropic account",
  openai: "Billed to your OpenAI account",
  google: "Billed to your Google account",
  openrouter: "Billed by OpenRouter",
  "ai-gateway": "Billed by Vercel's AI Gateway"
}
