import { HttpClientRequest } from "effect/http"
import { dollars, field, type KeyCheckFn, probe, verdict, worksWithModels } from "../secrets/key-probe.ts"

// Free checks for the model keys: each lists the key's models or reads its credit, spending no tokens.

const count = (value: unknown) => Array.isArray(value) ? value.length : null

// GET /v1/models (up to 1000 at once; Anthropic has far fewer).
export const checkAnthropicKey: KeyCheckFn = (base, key) =>
  probe("Anthropic", key, HttpClientRequest.get(`${base}/v1/models`).pipe(
    HttpClientRequest.setUrlParam("limit", "1000"),
    HttpClientRequest.setHeader("x-api-key", key),
    HttpClientRequest.setHeader("anthropic-version", "2023-06-01")
  ), ({ status, body }) => {
    const models = count(field(body, "data"))
    return status === 200 && models !== null ? worksWithModels(models) : null
  })

// GET /v1/models.
export const checkOpenAiKey: KeyCheckFn = (base, key) =>
  probe("OpenAI", key, HttpClientRequest.get(`${base}/v1/models`).pipe(HttpClientRequest.bearerToken(key)), ({ status, body }) => {
    const models = count(field(body, "data"))
    return status === 200 && models !== null ? worksWithModels(models) : null
  })

// GET /v1beta/models with the key in the x-goog-api-key header (never ?key= in a URL that could be logged). Only
// models that generate text are counted. A wrong key is a 400 there, not a 401.
export const checkGoogleKey: KeyCheckFn = (base, key) =>
  probe("Google", key, HttpClientRequest.get(`${base}/v1beta/models`).pipe(
    HttpClientRequest.setUrlParam("pageSize", "1000"),
    HttpClientRequest.setHeader("x-goog-api-key", key)
  ), ({ status, body }) => {
    const list = field(body, "models")
    if (status === 200 && Array.isArray(list)) {
      const generates = list.filter((m) => {
        const methods = field(m, "supportedGenerationMethods")
        return !Array.isArray(methods) || methods.includes("generateContent")
      })
      return worksWithModels(generates.length)
    }
    if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(JSON.stringify(body))) {
      return verdict("refused", "Google refused this key (it isn't a valid API key).")
    }
    return null
  })

// GET /api/v1/key: the key's own limit and what's left of it (null when it has no limit). Free-tier accounts that
// never bought credits only run free models.
export const checkOpenRouterKey: KeyCheckFn = (base, key) =>
  probe("OpenRouter", key, HttpClientRequest.get(`${base}/api/v1/key`).pipe(HttpClientRequest.bearerToken(key)), ({ status, body }) => {
    if (status !== 200) return null
    const data = field(body, "data")
    const remaining = field(data, "limit_remaining")
    if (typeof remaining === "number" && remaining <= 0) {
      return verdict("no-credit", "This key works but has no credit left (its spending limit is used up).")
    }
    if (field(data, "is_free_tier") === true) return verdict("ok", "Works, on OpenRouter's free tier (free models only until you buy credits).")
    return verdict("ok", typeof remaining === "number" ? `Works. ${dollars(remaining)} left on this key.` : "Works.")
  })

// GET /v1/credits, the call @ai-sdk/gateway's getCredits() makes (4.0.78): { balance, total_used } in dollars as
// strings. Models on your own provider keys (BYOK) still run with no credit.
export const checkGatewayKey: KeyCheckFn = (base, key) =>
  probe("the AI Gateway", key, HttpClientRequest.get(`${base}/v1/credits`).pipe(
    HttpClientRequest.bearerToken(key),
    HttpClientRequest.setHeader("ai-gateway-auth-method", "api-key"),
    HttpClientRequest.setHeader("ai-gateway-protocol-version", "0.0.1")
  ), ({ status, body }) => {
    if (status !== 200) return null
    const balance = Number(field(body, "balance"))
    if (!Number.isFinite(balance)) return verdict("ok", "Works.")
    return balance <= 0
      ? verdict("no-credit", "This key works but has no AI Gateway credit left. Models on your own provider keys (BYOK) still run.")
      : verdict("ok", `Works. ${dollars(balance)} credit left.`)
  })

export const MODEL_KEY_CHECKS = {
  anthropic: { check: checkAnthropicKey, base: "https://api.anthropic.com", override: "ANTHROPIC_API_URL" },
  openai: { check: checkOpenAiKey, base: "https://api.openai.com", override: "OPENAI_API_URL" },
  google: { check: checkGoogleKey, base: "https://generativelanguage.googleapis.com", override: "GOOGLE_API_URL" },
  openrouter: { check: checkOpenRouterKey, base: "https://openrouter.ai", override: "OPENROUTER_API_URL" },
  gateway: { check: checkGatewayKey, base: "https://ai-gateway.vercel.sh", override: "AI_GATEWAY_API_URL" }
} as const

