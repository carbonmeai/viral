import { createAnthropic } from "@ai-sdk/anthropic"
import { createGateway } from "@ai-sdk/gateway"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { type KeyProvider, priceOf, tokenCostUsd } from "@viral/contracts"
import type { LanguageModel, LanguageModelUsage, ProviderMetadata } from "ai"
import { Option, Schema } from "effect"

// What a run cost: reported by the service, estimated from its tokens at Viral's prices, or unknown (no price).
export interface RunCost {
  readonly costUsd: number | null
  readonly basis: "reported" | "estimate" | "unknown"
}

// What differs between the AI SDK providers: how a model is made from an id and a key, which models get cache
// markers, and where the cost comes from. Everything else (the loop, tools, images, history) is shared.
export interface Vendor {
  readonly provider: KeyProvider
  // "the AI Gateway", "Anthropic": for messages
  readonly name: string
  // where its key comes from, for the "no key" message
  readonly keyHint: string
  readonly modelExample: string
  // the conversation ids this vendor's runs are stored under ("anthropic:<uuid>"), so a resume never crosses vendors
  readonly sessionPrefix: string
  // `baseUrl`: the service's address without a path (tests point it at a fake server); undefined = the real one
  model(modelId: string, apiKey: string, baseUrl: string | undefined): LanguageModel
  // the providerOptions that mark a cacheable prefix on this model, or undefined when it caches on its own
  cache(modelId: string): CacheOptions | undefined
  cost(modelId: string, steps: ReadonlyArray<{ readonly providerMetadata: ProviderMetadata | undefined }>, usage: LanguageModelUsage): RunCost
}

// providerOptions under the vendor's name ({ anthropic: … } or { openrouter: … })
export type CacheOptions = Record<string, { cacheControl: { type: "ephemeral" } }>
const EPHEMERAL = { cacheControl: { type: "ephemeral" as const } }
const Usd = Schema.Union([Schema.String, Schema.Finite])

// Tokens × Viral's price table (contracts' model catalog), cached input read and written at their own rates.
const estimate = (provider: KeyProvider, modelId: string, usage: LanguageModelUsage): RunCost => {
  const price = priceOf(provider, modelId)
  if (price === undefined) return { costUsd: null, basis: "unknown" }
  return {
    costUsd: tokenCostUsd(price, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0
    }),
    basis: "estimate"
  }
}

// Sums a reported cost over the steps; a step without one makes the whole run's cost unknown.
const reported = <A>(
  steps: ReadonlyArray<{ readonly providerMetadata: ProviderMetadata | undefined }>,
  decode: (u: unknown) => Option.Option<A>,
  stepCost: (a: A) => number
): RunCost => {
  let total = 0
  for (const step of steps) {
    const found = decode(step.providerMetadata)
    if (Option.isNone(found)) return { costUsd: null, basis: "unknown" }
    total += stepCost(found.value)
  }
  return { costUsd: Math.round(total * 1e8) / 1e8, basis: "reported" }
}

// What the gateway reports a call cost, per step. `cost` is what it charged; with your own provider key (BYOK)
// that's 0 and the provider bills you `marketCost` instead, so the higher of the two is the real spend.
const GatewayCost = Schema.Struct({ gateway: Schema.Struct({ cost: Usd, marketCost: Schema.optional(Usd) }) })
const decodeGatewayCost = Schema.decodeUnknownOption(GatewayCost)

// OpenRouter's usage accounting (providerMetadata.openrouter.usage in @openrouter/ai-sdk-provider 3.1.0): `cost` is
// what OpenRouter charged in USD; with your own provider key (BYOK) the provider's charge is
// `costDetails.upstreamInferenceCost`, so the higher of the two is the real spend (as with the gateway).
const OpenRouterCost = Schema.Struct({
  openrouter: Schema.Struct({
    usage: Schema.Struct({
      cost: Schema.Finite,
      costDetails: Schema.optional(Schema.Struct({ upstreamInferenceCost: Schema.Finite }))
    })
  })
})
const decodeOpenRouterCost = Schema.decodeUnknownOption(OpenRouterCost)

const isAnthropicModel = (modelId: string) => modelId.startsWith("anthropic/")

export const VENDORS: Record<KeyProvider, Vendor> = {
  "ai-gateway": {
    provider: "ai-gateway",
    name: "the AI Gateway",
    keyHint: "add your AI Gateway key (AI_GATEWAY_API_KEY, or Settings › Accounts)",
    modelExample: "anthropic/claude-haiku-5.5",
    sessionPrefix: "gateway:",
    model: (modelId, apiKey) => createGateway({ apiKey })(modelId),
    cache: (modelId) => isAnthropicModel(modelId) ? { anthropic: EPHEMERAL } : undefined,
    cost: (_modelId, steps) =>
      reported(steps, decodeGatewayCost, (m) => Math.max(Number(m.gateway.cost) || 0, Number(m.gateway.marketCost ?? 0) || 0))
  },
  anthropic: {
    provider: "anthropic",
    name: "Anthropic",
    keyHint: "add your Anthropic key (ANTHROPIC_API_KEY, or Settings › Accounts)",
    modelExample: "claude-haiku-5-5",
    sessionPrefix: "anthropic:",
    model: (modelId, apiKey, baseUrl) => createAnthropic({ apiKey, ...(baseUrl === undefined ? {} : { baseURL: `${baseUrl}/v1` }) })(modelId),
    cache: () => ({ anthropic: EPHEMERAL }),
    cost: (modelId, _steps, usage) => estimate("anthropic", modelId, usage)
  },
  openai: {
    provider: "openai",
    name: "OpenAI",
    keyHint: "add your OpenAI key (OPENAI_API_KEY, or Settings › Accounts)",
    modelExample: "gpt-6-luna",
    sessionPrefix: "openai:",
    model: (modelId, apiKey, baseUrl) => createOpenAI({ apiKey, ...(baseUrl === undefined ? {} : { baseURL: `${baseUrl}/v1` }) })(modelId),
    cache: () => undefined,
    cost: (modelId, _steps, usage) => estimate("openai", modelId, usage)
  },
  google: {
    provider: "google",
    name: "Google",
    keyHint: "add your Google Gemini key (GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY, or Settings › Accounts)",
    modelExample: "gemini-3.8-flash",
    sessionPrefix: "google:",
    model: (modelId, apiKey, baseUrl) =>
      createGoogleGenerativeAI({ apiKey, ...(baseUrl === undefined ? {} : { baseURL: `${baseUrl}/v1beta` }) })(modelId),
    cache: () => undefined,
    cost: (modelId, _steps, usage) => estimate("google", modelId, usage)
  },
  openrouter: {
    provider: "openrouter",
    name: "OpenRouter",
    keyHint: "add your OpenRouter key (OPENROUTER_API_KEY, or Settings › Accounts)",
    modelExample: "anthropic/claude-haiku-5.5",
    sessionPrefix: "openrouter:",
    // usage accounting on, so every answer carries its cost
    model: (modelId, apiKey, baseUrl) =>
      createOpenRouter({ apiKey, ...(baseUrl === undefined ? {} : { baseURL: `${baseUrl}/api/v1` }) })(modelId, { usage: { include: true } }),
    // OpenRouter passes Anthropic's cache_control through for anthropic/… models
    cache: (modelId) => isAnthropicModel(modelId) ? { openrouter: EPHEMERAL } : undefined,
    cost: (_modelId, steps) =>
      reported(steps, decodeOpenRouterCost, (m) => Math.max(m.openrouter.usage.cost, m.openrouter.usage.costDetails?.upstreamInferenceCost ?? 0))
  }
}
