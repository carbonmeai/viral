import { Schema } from "effect"
import type { AgentProvider, AgentStage } from "./settings.ts"

// The providers that run on an API key through the AI SDK (packages/provider-ai-sdk), and the key each one uses.
export const KEY_PROVIDERS = ["anthropic", "openai", "google", "openrouter", "ai-gateway"] as const
export type KeyProvider = typeof KEY_PROVIDERS[number]
export const KeyProvider = Schema.Literals(KEY_PROVIDERS)
export const isKeyProvider = (provider: AgentProvider): provider is KeyProvider => (KEY_PROVIDERS as ReadonlyArray<string>).includes(provider)
export const PROVIDER_KEY = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  openrouter: "openrouter",
  "ai-gateway": "gateway"
} as const satisfies Record<KeyProvider, string>

// What a million tokens cost in USD: fresh input, output, input read from the cache, and input written to it (only
// Anthropic charges extra for writing; elsewhere it's the input price).
export interface TokenPrice {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

// sees images / fast and cheap enough for the short steps
export type ModelBadge = "vision" | "fast"

export interface CatalogModel {
  readonly provider: KeyProvider
  // the vendor's own id ("claude-haiku-5-5"); on OpenRouter and the AI Gateway, vendor/model
  readonly id: string
  readonly label: string
  // one line on what it's good for
  readonly description: string
  readonly badges: ReadonlyArray<ModelBadge>
  // the steps it's recommended for ("default" = a good default for every step)
  readonly recommendedFor: ReadonlyArray<AgentStage | "default">
  readonly price: TokenPrice
}

const SHORT_STEPS: ReadonlyArray<AgentStage> = ["research", "ads", "metadata"]
const WRITING_STEPS: ReadonlyArray<AgentStage | "default"> = ["default", "story", "set-story", "script"]

// Prices per million tokens, from the vendors' list prices (as the AI Gateway's public model list shows them,
// https://ai-gateway.vercel.sh/v1/models, November 2026). Update with releases: Anthropic, OpenAI and Google report
// tokens, not dollars, so their recorded cost is tokens × these prices and is marked "estimate".
const HAIKU: TokenPrice = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
const SONNET: TokenPrice = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }
const OPUS: TokenPrice = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }
const LUNA: TokenPrice = { input: 0.1, output: 0.5, cacheRead: 0.01 }
const SOL: TokenPrice = { input: 2, output: 10, cacheRead: 0.1 }
const TERRA: TokenPrice = { input: 1, output: 5, cacheRead: 0.05 }
const ASTRA: TokenPrice = { input: 10, output: 50, cacheRead: 1 }
const FLASH: TokenPrice = { input: 0.75, output: 3.75, cacheRead: 0.075 }
const FLASH_LITE: TokenPrice = { input: 0.3, output: 2.5, cacheRead: 0.03 }
const ARGON: TokenPrice = { input: 2, output: 10, cacheRead: 0.1 }

const family = {
  haiku: { label: "Claude Haiku 5.5", description: "Fast and cheap, good for ads, research and titles", badges: ["vision", "fast"], recommendedFor: SHORT_STEPS, price: HAIKU },
  sonnet: { label: "Claude Sonnet 5.5", description: "Strong writing at a fair price; a good default", badges: ["vision"], recommendedFor: WRITING_STEPS, price: SONNET },
  opus: { label: "Claude Opus 5.5", description: "Strongest Claude for story and script, slower", badges: ["vision"], recommendedFor: [], price: OPUS },
  luna: { label: "GPT-6 Luna", description: "Fast and cheap, good for ads and titles", badges: ["vision", "fast"], recommendedFor: SHORT_STEPS, price: LUNA },
  sol: { label: "GPT-6.1 Sol", description: "Strong writing; a good default", badges: ["vision"], recommendedFor: WRITING_STEPS, price: SOL },
  terra: { label: "GPT-6.1 Terra", description: "Between Luna and Sol in price and strength", badges: ["vision"], recommendedFor: [], price: TERRA },
  astra: { label: "GPT-6 Astra", description: "OpenAI's strongest, slow and expensive", badges: ["vision"], recommendedFor: [], price: ASTRA },
  flash: { label: "Gemini 3.8 Flash", description: "Fast, sees images, a good default", badges: ["vision", "fast"], recommendedFor: ["default", ...SHORT_STEPS], price: FLASH },
  flashLite: { label: "Gemini 3.5 Flash Lite", description: "Cheap and quick for short steps", badges: ["vision", "fast"], recommendedFor: [], price: FLASH_LITE },
  argon: { label: "Gemini 4 Argon", description: "Google's strongest, for story and script", badges: ["vision"], recommendedFor: ["story", "set-story", "script"], price: ARGON }
} as const satisfies Record<string, Omit<CatalogModel, "provider" | "id">>

const entry = (provider: KeyProvider, id: string, of: Omit<CatalogModel, "provider" | "id">): CatalogModel => ({ provider, id, ...of })

// The models offered first in Settings › Agents, per provider; the live list from your key follows under "More",
// and any other id can be typed in.
export const MODEL_CATALOG: ReadonlyArray<CatalogModel> = [
  entry("anthropic", "claude-haiku-5-5", family.haiku),
  entry("anthropic", "claude-sonnet-5-5", family.sonnet),
  entry("anthropic", "claude-opus-5-5", family.opus),
  entry("openai", "gpt-6-luna", family.luna),
  entry("openai", "gpt-6.1-sol", family.sol),
  entry("openai", "gpt-6.1-terra", family.terra),
  entry("openai", "gpt-6-astra", family.astra),
  entry("google", "gemini-3.8-flash", family.flash),
  entry("google", "gemini-3.5-flash-lite", family.flashLite),
  entry("google", "gemini-4-argon", family.argon),
  entry("openrouter", "anthropic/claude-haiku-5.5", family.haiku),
  entry("openrouter", "anthropic/claude-sonnet-5.5", family.sonnet),
  entry("openrouter", "openai/gpt-6-luna", family.luna),
  entry("openrouter", "google/gemini-3.8-flash", family.flash),
  entry("ai-gateway", "anthropic/claude-haiku-5.5", family.haiku),
  entry("ai-gateway", "anthropic/claude-sonnet-5.5", family.sonnet),
  entry("ai-gateway", "anthropic/claude-opus-5.5", family.opus),
  entry("ai-gateway", "openai/gpt-6-luna", family.luna),
  entry("ai-gateway", "openai/gpt-6.1-sol", family.sol),
  entry("ai-gateway", "google/gemini-3.8-flash", family.flash)
]

export const catalogFor = (provider: AgentProvider) => MODEL_CATALOG.filter((m) => m.provider === provider)
export const catalogModel = (provider: AgentProvider, id: string | null) =>
  id === null ? undefined : MODEL_CATALOG.find((m) => m.provider === provider && m.id === id)

// Prices of models outside the catalog that runs may still name (older ids, dated snapshots). The catalog's own
// prices come first.
const MORE_PRICES: Record<string, TokenPrice> = {
  "anthropic:claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  "anthropic:claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "anthropic:claude-sonnet-5": SONNET,
  "openai:gpt-6-sol": { input: 2, output: 10, cacheRead: 0.2 },
  "openai:gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02 },
  "google:gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15 },
  "google:gemini-3.7-flash": FLASH,
  "google:gemini-3.6-flash": FLASH
}

// A model's price per million tokens, or undefined when Viral doesn't know it. Dated ids
// ("claude-haiku-5-5-20261001") are priced as their model.
export const priceOf = (provider: AgentProvider, model: string): TokenPrice | undefined => {
  const bare = model.replace(/-\d{8}$/, "")
  return catalogModel(provider, model)?.price ?? catalogModel(provider, bare)?.price ?? MORE_PRICES[`${provider}:${bare}`]
}

export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  // parts of inputTokens read from / written to the prompt cache
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

// What tokens cost at a price: fresh input, cache reads and writes, and output, each at its own rate.
export const tokenCostUsd = (price: TokenPrice, usage: TokenUsage) => {
  const read = usage.cacheReadTokens ?? 0
  const write = usage.cacheWriteTokens ?? 0
  const fresh = Math.max(0, usage.inputTokens - read - write)
  const usd = (fresh * price.input + read * (price.cacheRead ?? price.input) + write * (price.cacheWrite ?? price.input) +
    usage.outputTokens * price.output) / 1e6
  return Math.round(usd * 1e8) / 1e8
}

// The catalog's cheapest model for a provider (by a typical step's mix: four input tokens to one output).
export const cheapestFor = (provider: AgentProvider): string | undefined =>
  catalogFor(provider)
    .map((m) => ({ id: m.id, blended: m.price.input * 4 + m.price.output }))
    .sort((a, b) => a.blended - b.blended)[0]?.id
