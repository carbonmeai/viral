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
  seesImages,
  type TokenPrice,
  VISION_STAGES
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
  // what it's good for (the id, for a model from your key's list)
  readonly description: string | undefined
  readonly badges: ReadonlyArray<Badge>
  readonly note: string | undefined
  readonly group: string | undefined
  // greyed out: the step looks at images and this model doesn't take them
  readonly disabled?: boolean
}

// Whether a step looks at images (shots, sections, ranking moments, thumbnail), so it needs a model that sees them.
export const isVisionStage = (stage: AgentStage | null) => stage !== null && VISION_STAGES.includes(stage)

// Why a model is greyed out for an image step, in the menu.
export const NO_IMAGES = "Doesn’t take images"

export type Badge = "Sees images" | "Fast" | "Cheapest" | "Recommended" | "On your plan"

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
// On an image step a model that doesn't take images (by Viral's catalog and families, the vendor's list, or the
// models remembered from it in `seen`) is greyed out, unless it's the one chosen.
export const keyModelOptions = (
  provider: AgentProvider,
  stage: AgentStage | null,
  live: KeyModels | undefined,
  evals: ReadonlyArray<ModelEval>,
  current: string | null,
  seen: ReadonlyArray<string> = []
): ReadonlyArray<ModelOption> => {
  if (!isKeyProvider(provider)) return []
  const vision = isVisionStage(stage)
  const blind = (id: string, listed: boolean | null) =>
    vision && id !== current && listed !== true && !seesImages({ provider, model: id }, seen)
  const greyed = (id: string, listed: boolean | null, note: string | undefined) =>
    blind(id, listed) ? { disabled: true, note: NO_IMAGES } : { note }
  const curated = catalogFor(provider).map((m): ModelOption => {
    const e = findEval(evals, { provider, model: m.id })
    const badges = badgesFor(provider, m.id, stage)
    return {
      value: m.id,
      label: m.label,
      description: m.description,
      badges,
      ...greyed(m.id, null, e === undefined ? priceLine(m.price) : evalCost(e)),
      group: "Suggested"
    }
  })
  const known = new Set(curated.map((m) => m.value))
  const more = (live?.models ?? []).filter((m) => !known.has(m.id)).slice(0, MORE_LIMIT).map((m): ModelOption => {
    const e = findEval(evals, { provider, model: m.id })
    const sees = m.vision === true || seesImages({ provider, model: m.id }, seen)
    return {
      value: m.id,
      label: m.label === m.id ? m.id : m.label,
      description: m.label === m.id ? undefined : m.id,
      badges: sees ? ["Sees images"] : [],
      ...greyed(m.id, m.vision, e === undefined ? undefined : evalCost(e)),
      group: "More from your key"
    }
  })
  const listed = new Set([...known, ...more.map((m) => m.value)])
  const chosen = current !== null && !listed.has(current)
    ? [{ value: current, label: current, description: undefined, badges: [], note: undefined, group: "More from your key" }]
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

// The Provider picker (Settings › Agents, and a generator's Model row): your plans first (the Claude CLI, Codex), then
// pay per run (your API keys), then what runs on this Mac (OpenCode). Each says who pays and what it can do; one that
// isn't set up is greyed out with where to set it up, and on an image step so are the apps that can't look at images in
// Viral. The chosen one always stays pickable, so the page tells the truth. Detailed mode adds how its default did in
// your evals.
export interface ProviderChoice {
  readonly value: AgentProvider
  readonly label: string
  readonly description: string
  readonly badges: ReadonlyArray<Badge>
  readonly note: string | undefined
  readonly detail: string | undefined
  readonly disabled: boolean
  readonly group: "Your plans" | "Pay per run" | "On this Mac"
  readonly mark: string
}

const PROVIDER_LINES: Record<AgentProvider, string> = {
  "claude-cli": "Your Claude plan, no API bill. Looks at images, so it can run Shots, Sections and Thumbnail.",
  codex: "Your ChatGPT plan, no API bill. Text steps only.",
  opencode: "The models you set up in OpenCode on this Mac. Text steps only.",
  anthropic: "Claude models on your Anthropic key, billed per run.",
  openai: "GPT models on your OpenAI key, billed per run.",
  google: "Gemini models on your Google key, billed per run.",
  openrouter: "Hundreds of models on one OpenRouter key, billed per run.",
  "ai-gateway": "Many vendors' models through Vercel's AI Gateway, billed per run."
}
const MARKS: Record<AgentProvider, string> = {
  "claude-cli": "CC", codex: "CX", opencode: "OC", anthropic: "A", openai: "O", google: "G", openrouter: "OR", "ai-gateway": "AG"
}
const GROUP_OF = (p: AgentProvider): ProviderChoice["group"] =>
  p === "claude-cli" || p === "codex" ? "Your plans" : p === "opencode" ? "On this Mac" : "Pay per run"
const PICKER_ORDER: ReadonlyArray<AgentProvider> = ["claude-cli", "codex", "anthropic", "openai", "google", "openrouter", "ai-gateway", "opencode"]

export const providerChoices = (
  ready: Readonly<Record<AgentProvider, boolean>>,
  chosen: AgentProvider | null,
  vision: boolean,
  evals: ReadonlyArray<ModelEval> = [],
  detailed = false
): ReadonlyArray<ProviderChoice> =>
  PICKER_ORDER.map((p) => {
    const blind = vision && (p === "codex" || p === "opencode")
    const why = p === chosen ? undefined : blind ? "Can’t look at images in Viral" : ready[p] ? undefined : isKeyProvider(p) ? "Add a key in Accounts" : "Set up in Accounts"
    const badges: Array<Badge> = []
    if (p === "claude-cli") badges.push("Recommended")
    if (p === "claude-cli" || p === "codex") badges.push("On your plan")
    return {
      value: p,
      label: providerName(p),
      description: PROVIDER_LINES[p],
      badges,
      note: why,
      detail: detailed ? evalLine(evals, { provider: p, model: null }) ?? undefined : undefined,
      disabled: why !== undefined,
      group: GROUP_OF(p),
      mark: MARKS[p]
    }
  })

// The Claude CLI's and Codex's models in the picker: each runs on your plan; the CLI's say what they're good for.
export const cliModelChoices = (provider: "claude-cli" | "codex", catalog: ReadonlyArray<CliModels>, evals: ReadonlyArray<ModelEval> = [], detailed = false): ReadonlyArray<ModelOption & { readonly detail: string | undefined }> => {
  const detail = (model: string | null) => detailed ? evalLine(evals, { provider, model }) ?? undefined : undefined
  if (provider === "claude-cli") {
    return CLI_MODELS.map((m) => ({
      value: m.id ?? "default",
      label: m.label,
      description: m.description,
      badges: ["On your plan", ...(m.id === null ? [] : ["Sees images" as const])],
      note: undefined,
      group: "Your Claude plan",
      detail: detail(m.id)
    }))
  }
  return [
    { value: "default", label: "Codex default", description: "The model your ChatGPT plan's Codex picks", badges: ["On your plan"], note: undefined, group: "Your ChatGPT plan", detail: detail(null) },
    ...(catalog.find((c) => c.provider === "codex")?.models ?? []).map((m) => ({
      value: m.id,
      label: m.label,
      description: m.id === m.label ? undefined : m.id,
      badges: ["On your plan" as const],
      note: undefined,
      group: "Your ChatGPT plan",
      detail: detail(m.id)
    }))
  ]
}
