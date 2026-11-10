import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"

// One fake HTTP server standing in for every service a key is checked against, so tests never touch a real
// account. The key decides the answer: "good-key…" works, "bad-key…" is refused, "broke-key…" has no credit,
// "down-key…" meets a failing service; a few services have their own extra cases (below). Every request is kept,
// so a test can check how the key was sent.
export interface FakeKeyServices {
  readonly base: string
  readonly requests: Array<{ readonly method: string; readonly url: string; readonly headers: IncomingMessage["headers"] }>
  close(): Promise<void>
}

const keyOf = (req: IncomingMessage) => {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "")
  const value = req.headers["x-api-key"] ?? req.headers["x-goog-api-key"] ?? req.headers["xi-api-key"] ?? bearer ?? ""
  return Array.isArray(value) ? value[0] ?? "" : value
}

export const startFakeKeyServices = async (): Promise<FakeKeyServices> => {
  const requests: FakeKeyServices["requests"] = []
  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers })
    const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value))
    const path = (req.url ?? "").split("?")[0]
    const key = keyOf(req)
    const is = (kind: string) => key.startsWith(`${kind}-key`)
    if (is("down")) return json(503, { error: { message: "service unavailable" } })

    // Anthropic: x-api-key on /v1/models; OpenAI: a bearer token on the same path
    if (path === "/v1/models" && req.headers["x-api-key"] !== undefined) {
      if (is("good")) return json(200, { data: [{ id: "claude-haiku-5-5" }, { id: "claude-sonnet-5-5" }, { id: "claude-opus-5-5" }], has_more: false })
      return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })
    }
    // the AI Gateway's model list (public; a "good-key-gateway…" key tells it apart from OpenAI's on this one server)
    if (path === "/v1/models" && key.startsWith("good-key-gateway")) {
      return json(200, {
        object: "list",
        data: [
          { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", type: "language", tags: ["tool-use", "vision"], modalities: { input: ["text", "image"], output: ["text"] } },
          { id: "openai/gpt-6-luna", name: "GPT-6 Luna", type: "language", tags: ["tool-use"], modalities: { input: ["text", "image"], output: ["text"] } },
          { id: "alibaba/qwen-tiny", name: "Qwen Tiny", type: "language", tags: [], modalities: { input: ["text"], output: ["text"] } },
          { id: "openai/text-embedding-9", name: "Embedding 9", type: "embedding", tags: [], modalities: { input: ["text"], output: ["text"] } }
        ]
      })
    }
    if (path === "/v1/models") {
      if (is("good")) return json(200, { object: "list", data: [{ id: "gpt-6-luna" }, { id: "gpt-6" }, { id: "gpt-5" }, { id: "o9" }, { id: "whisper-2" }] })
      if (is("busy")) return json(429, { error: { message: "Rate limit reached" } })
      // OpenAI echoes part of the key; the check must not pass it on
      return json(401, { error: { message: `Incorrect API key provided: ${key}. You can find your API key at https://platform.openai.com/account/api-keys.`, type: "invalid_request_error", code: "invalid_api_key" } })
    }
    // Google: only models that generate text count; a wrong key is a 400
    if (path === "/v1beta/models") {
      if (is("good")) {
        return json(200, {
          models: [
            { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
            { name: "models/gemini-3.5-pro", supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] }
          ]
        })
      }
      if (is("off")) return json(403, { error: { code: 403, message: "Generative Language API has not been used in this project before or it is disabled", status: "PERMISSION_DENIED" } })
      return json(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } })
    }
    // OpenRouter: the key's own limit
    if (path === "/api/v1/key") {
      if (is("good")) return json(200, { data: { label: "sk-or-v1-abc…", limit: 10, usage: 2.5, limit_remaining: 7.5, is_free_tier: false } })
      if (is("free")) return json(200, { data: { label: "sk-or-v1-abc…", limit: null, usage: 0, limit_remaining: null, is_free_tier: true } })
      if (is("broke")) return json(200, { data: { label: "sk-or-v1-abc…", limit: 5, usage: 5, limit_remaining: 0, is_free_tier: false } })
      return json(401, { error: { message: "No auth credentials found", code: 401 } })
    }
    // OpenRouter's model list: only models that take tools can run a step
    if (path === "/api/v1/models") {
      if (!is("good")) return json(401, { error: { message: "No auth credentials found", code: 401 } })
      return json(200, {
        data: [
          { id: "anthropic/claude-haiku-5.5", name: "Anthropic: Claude Haiku 5.5", architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools", "max_tokens"] },
          { id: "meta-llama/llama-9-8b", name: "Meta: Llama 9 8B", architecture: { input_modalities: ["text"] }, supported_parameters: ["tools"] },
          { id: "some/no-tools", name: "No Tools", architecture: { input_modalities: ["text"] }, supported_parameters: ["max_tokens"] }
        ]
      })
    }
    // the AI Gateway: credits, as @ai-sdk/gateway's getCredits() reads them
    if (path === "/v1/credits") {
      if (req.headers["ai-gateway-auth-method"] !== "api-key") return json(400, { error: { message: "missing auth method" } })
      if (is("good")) return json(200, { balance: "12.5", total_used: "3.25" })
      if (is("broke")) return json(200, { balance: "0", total_used: "40" })
      return json(401, { error: { message: "Invalid API key", type: "authentication_error" } })
    }
    // ElevenLabs: a key can lack the User read permission and still work
    if (path === "/v1/user") {
      if (is("good")) return json(200, { subscription: { tier: "creator" } })
      if (is("limited")) {
        return json(401, { detail: { status: "missing_permissions", message: "The API key you used is missing the permission user_read to execute this operation." } })
      }
      return json(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } })
    }
    // xAI: the key's own record; a wrong key is a 400
    if (path === "/v1/api-key") {
      const record = { redacted_api_key: "xai-…abcd", api_key_blocked: false, api_key_disabled: false, team_blocked: false }
      if (is("good")) return json(200, record)
      if (is("off")) return json(200, { ...record, api_key_disabled: true })
      if (is("broke")) return json(200, { ...record, team_blocked: true })
      return json(400, { code: "Client specified an invalid argument", error: `Incorrect API key provided: ${key}. You can obtain an API key from https://console.x.ai.` })
    }
    json(404, { error: { message: "not found" } })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

// An address nothing listens on, for "couldn't reach".
export const UNREACHABLE = "http://127.0.0.1:9"
