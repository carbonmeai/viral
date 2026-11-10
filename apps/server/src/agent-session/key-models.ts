import { type KeyModel, type KeyModels, type KeyProvider, PROVIDER_KEY } from "@viral/contracts"
import { Clock, Config, Context, DateTime, Duration, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { Secrets } from "../secrets/secrets.ts"
import { field } from "../secrets/key-probe.ts"
import { MODEL_KEY_CHECKS } from "./model-key-checks.ts"

// The models each key can use, from the vendor's own list: the same free calls as the key checks (no tokens),
// kept for a day. Only models that can call tools are listed, since every agent step answers through a tool.

const DAY_MS = Duration.toMillis(Duration.days(1))
const TIMEOUT = Duration.seconds(10)

const text = (value: unknown) => typeof value === "string" && value.trim() !== "" ? value.trim() : null
const list = (value: unknown): ReadonlyArray<unknown> => Array.isArray(value) ? value : []
const strings = (value: unknown): ReadonlyArray<string> => list(value).filter((v): v is string => typeof v === "string")

// Each vendor's list call and how to read it.
interface Lister {
  readonly service: string
  request(base: string, key: string): HttpClientRequest.HttpClientRequest
  read(body: unknown): ReadonlyArray<KeyModel>
}

// OpenAI's list has every model the key can reach (embeddings, speech, images…); only the chat and reasoning
// families answer with tools.
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/
const OPENAI_NOT_CHAT = /(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation)/

export const LISTERS: Record<KeyProvider, Lister> = {
  anthropic: {
    service: "Anthropic",
    request: (base, key) =>
      HttpClientRequest.get(`${base}/v1/models`).pipe(
        HttpClientRequest.setUrlParam("limit", "1000"),
        HttpClientRequest.setHeader("x-api-key", key),
        HttpClientRequest.setHeader("anthropic-version", "2023-06-01")
      ),
    // every Claude model takes images
    read: (body) =>
      list(field(body, "data")).flatMap((m) => {
        const id = text(field(m, "id"))
        return id === null ? [] : [{ id, label: text(field(m, "display_name")) ?? id, vision: true }]
      })
  },
  openai: {
    service: "OpenAI",
    request: (base, key) => HttpClientRequest.get(`${base}/v1/models`).pipe(HttpClientRequest.bearerToken(key)),
    read: (body) =>
      list(field(body, "data")).flatMap((m) => {
        const id = text(field(m, "id"))
        return id === null || !OPENAI_CHAT.test(id) || OPENAI_NOT_CHAT.test(id) ? [] : [{ id, label: id, vision: id.startsWith("gpt-") ? true : null }]
      })
  },
  google: {
    service: "Google",
    request: (base, key) =>
      HttpClientRequest.get(`${base}/v1beta/models`).pipe(
        HttpClientRequest.setUrlParam("pageSize", "1000"),
        HttpClientRequest.setHeader("x-goog-api-key", key)
      ),
    // Gemini models generate text and take images; embedding, image and speech models don't answer with tools
    read: (body) =>
      list(field(body, "models")).flatMap((m) => {
        const id = text(field(m, "name"))?.replace(/^models\//, "") ?? null
        const generates = strings(field(m, "supportedGenerationMethods")).includes("generateContent")
        if (id === null || !generates || !id.startsWith("gemini") || /(embedding|image|tts|audio)/.test(id)) return []
        return [{ id, label: text(field(m, "displayName")) ?? id, vision: true }]
      })
  },
  openrouter: {
    service: "OpenRouter",
    request: (base, key) => HttpClientRequest.get(`${base}/api/v1/models`).pipe(HttpClientRequest.bearerToken(key)),
    read: (body) =>
      list(field(body, "data")).flatMap((m) => {
        const id = text(field(m, "id"))
        if (id === null || !strings(field(m, "supported_parameters")).includes("tools")) return []
        return [{ id, label: text(field(m, "name")) ?? id, vision: strings(field(field(m, "architecture"), "input_modalities")).includes("image") }]
      })
  },
  "ai-gateway": {
    service: "the AI Gateway",
    request: (base, key) => HttpClientRequest.get(`${base}/v1/models`).pipe(HttpClientRequest.bearerToken(key)),
    read: (body) =>
      list(field(body, "data")).flatMap((m) => {
        const id = text(field(m, "id"))
        if (id === null || field(m, "type") !== "language" || !strings(field(m, "tags")).includes("tool-use")) return []
        return [{ id, label: text(field(m, "name")) ?? id, vision: strings(field(field(m, "modalities"), "input")).includes("image") }]
      })
  }
}

const empty = (provider: KeyProvider, problem: string): KeyModels => ({ provider, models: [], problem, fetchedAt: null })

// Lists a key provider's models for Settings › Agents. Never fails: no key, a refused key or an unreachable service
// comes back as a plain `problem`. A list is kept for a day per key (a new key lists again).
export class KeyModelLists extends Context.Service<KeyModelLists, {
  list(provider: KeyProvider): Effect.Effect<KeyModels>
}>()("@viral/server/agent-session/key-models/KeyModelLists") {
  static readonly make = Effect.gen(function*() {
    const secrets = yield* Secrets
    const client = yield* HttpClient.HttpClient
    // which key a list belongs to, as a hash: the key itself is never kept here
    const kept = new Map<KeyProvider, { readonly keyHash: string; readonly at: number; readonly value: KeyModels }>()

    const fetch = Effect.fn("KeyModelLists.fetch")(function*(provider: KeyProvider, key: string) {
      const lister = LISTERS[provider]
      const check = MODEL_KEY_CHECKS[PROVIDER_KEY[provider]]
      const base = (yield* Config.String(check.override).pipe(Config.withDefault(check.base), Effect.orDie)).replace(/\/+$/, "")
      const answer = yield* client.execute(lister.request(base, key)).pipe(
        Effect.timeout(TIMEOUT),
        Effect.flatMap((res) => Effect.map(res.json.pipe(Effect.orElseSucceed(() => null)), (body) => ({ status: res.status, body }))),
        Effect.option
      )
      if (Option.isNone(answer)) return empty(provider, `Couldn't reach ${lister.service}.`)
      const { status, body } = answer.value
      if (status === 401 || status === 403 || (provider === "google" && status === 400)) return empty(provider, `${lister.service} refused this key. Check it in Accounts.`)
      if (status < 200 || status >= 300) return empty(provider, `${lister.service} answered with ${status}.`)
      const models = [...lister.read(body)].sort((a, b) => a.label.localeCompare(b.label))
      return { provider, models, problem: null, fetchedAt: DateTime.formatIso(yield* DateTime.now) } satisfies KeyModels
    })

    const listModels = Effect.fn("KeyModelLists.list")(function*(provider: KeyProvider) {
      const key = yield* secrets.get(PROVIDER_KEY[provider])
      if (Option.isNone(key)) return empty(provider, "Add a key in Accounts.")
      const value = Redacted.value(key.value)
      const digest = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
      const keyHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
      const now = yield* Clock.currentTimeMillis
      const hit = kept.get(provider)
      if (hit !== undefined && hit.keyHash === keyHash && now - hit.at < DAY_MS) return hit.value
      const fresh = yield* fetch(provider, value)
      // only a good list is kept: a failure is asked again next time
      if (fresh.problem === null) kept.set(provider, { keyHash, at: now, value: fresh })
      return fresh
    })

    return KeyModelLists.of({ list: listModels })
  })

  static readonly layer = Layer.effect(KeyModelLists, KeyModelLists.make).pipe(Layer.provide([Secrets.layer, FetchHttpClient.layer]))
}
