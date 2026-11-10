import { NodeServices } from "@effect/platform-node"
import type { KeyProvider } from "@viral/contracts"
import { type AgentCost, type AgentHooks, type AgentTask } from "@viral/provider-core"
import { Effect, Layer, Redacted, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { makeAiSdkProvider } from "./ai-sdk-provider.ts"

// Each direct vendor's real AI SDK factory against a fake server that speaks that vendor's API: one answer that
// calls the output tool. Proves the request reaches the right endpoint with the key in the right header, the
// tool call comes back through the schema, the cache markers go where they should, and the cost is read the way
// each vendor gives it (OpenRouter reports dollars; Anthropic, OpenAI and Google report tokens).

interface Seen {
  readonly path: string
  readonly headers: IncomingMessage["headers"]
  readonly body: Record<string, unknown>
}

const INPUT = { answer: 42 }
const ARGS = JSON.stringify(INPUT)

const answers: Record<string, (body: Record<string, unknown>) => unknown> = {
  // Anthropic Messages
  "/v1/messages": (body) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: body.model,
    content: [{ type: "tool_use", id: "toolu_1", name: "propose_answer", input: INPUT }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 }
  }),
  // OpenAI Responses
  "/v1/responses": (body) => ({
    id: "resp_1",
    object: "response",
    created_at: 1_790_000_000,
    model: body.model,
    status: "completed",
    output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "propose_answer", arguments: ARGS, status: "completed" }],
    usage: { input_tokens: 5000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 5200 }
  }),
  // Google generateContent
  "/v1beta/models/gemini-3.8-flash:generateContent": () => ({
    candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "propose_answer", args: INPUT } }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 200, totalTokenCount: 5200 }
  }),
  "/v1beta/models/gemini-0-unknown:generateContent": () => ({
    candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "propose_answer", args: INPUT } }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 200, totalTokenCount: 5200 }
  }),
  // OpenRouter chat completions, with usage accounting
  "/api/v1/chat/completions": (body) => ({
    id: "gen-1",
    object: "chat.completion",
    created: 1_790_000_000,
    model: body.model,
    provider: "Anthropic",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "propose_answer", arguments: ARGS } }] },
      finish_reason: "tool_calls"
    }],
    usage: { prompt_tokens: 5000, completion_tokens: 200, total_tokens: 5200, cost: 0.00123 }
  })
}

let server: Server
let base: string
let home: string
const seen: Array<Seen> = []

before(async () => {
  home = mkdtempSync(join(tmpdir(), "viral-ai-sdk-vendors-"))
  server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => raw += chunk)
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0] ?? ""
      const body = raw === "" ? {} : JSON.parse(raw) as Record<string, unknown>
      seen.push({ path, headers: req.headers, body })
      const answer = answers[path]
      if (answer === undefined) return res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `no ${path}` } }))
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer(body)))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(home, { recursive: true, force: true })
})

const Answer = Schema.Struct({ answer: Schema.Int })
const task: AgentTask<typeof Answer> = {
  stage: "test",
  instructions: "Answer.",
  skills: [],
  message: "What is 6 × 7?",
  output: { tool: "propose_answer", description: "Submit the answer.", schema: Answer },
  defaultModel: null
}

const runOn = async (provider: KeyProvider, model: string) => {
  const costs: Array<AgentCost> = []
  const sessions: Array<string> = []
  const hooks: AgentHooks = {
    progress: () => Effect.void,
    recordCost: (cost) => Effect.sync(() => void costs.push(cost)),
    recordSession: (id) => Effect.sync(() => void sessions.push(id))
  }
  const from = seen.length
  const answer = await Effect.runPromise(
    makeAiSdkProvider({
      provider,
      apiKey: Effect.succeedSome(Redacted.make(`test-key-${provider}`)),
      sessionsDir: join(home, "agent-sessions"),
      baseUrl: base
    }).pipe(
      Effect.flatMap((run) => run(task, hooks, model, "Answer.")),
      Effect.provide(Layer.mergeAll(NodeServices.layer, SecureRandom.layerWebCrypto))
    )
  )
  return { answer, costs, sessions, requests: seen.slice(from) }
}

test("Anthropic: x-api-key, cache markers on the prompt, cost estimated from tokens with cache reads", async () => {
  const r = await runOn("anthropic", "claude-haiku-5-5")
  assert.deepEqual(r.answer, INPUT)
  assert.equal(r.requests.length, 1)
  assert.equal(r.requests[0]!.path, "/v1/messages")
  assert.equal(r.requests[0]!.headers["x-api-key"], "test-key-anthropic")
  assert.match(JSON.stringify(r.requests[0]!.body.system), /"cache_control":\{"type":"ephemeral"\}/)
  assert.match(r.sessions[0]!, /^anthropic:/)
  // Haiku 5.5: 1000 fresh × $0.10 + 4000 cached × $0.01 + 200 out × $0.50, per million
  assert.deepEqual(r.costs, [{ model: "claude-haiku-5-5", inputTokens: 5000, outputTokens: 200, costUsd: 0.00024, costBasis: "estimate" }])
})

test("OpenAI: a bearer key on the Responses API, no cache markers, cost estimated from tokens", async () => {
  const r = await runOn("openai", "gpt-6-luna")
  assert.deepEqual(r.answer, INPUT)
  assert.equal(r.requests[0]!.path, "/v1/responses")
  assert.equal(r.requests[0]!.headers.authorization, "Bearer test-key-openai")
  assert.doesNotMatch(JSON.stringify(r.requests[0]!.body), /cache_control/)
  assert.match(r.sessions[0]!, /^openai:/)
  // GPT-6 Luna: 5000 × $0.10 + 200 × $0.50, per million
  assert.deepEqual(r.costs, [{ model: "gpt-6-luna", inputTokens: 5000, outputTokens: 200, costUsd: 0.0006, costBasis: "estimate" }])
})

test("Google: the key in x-goog-api-key (never in the URL), cost estimated; an unpriced model's cost is unknown, not $0", async () => {
  const r = await runOn("google", "gemini-3.8-flash")
  assert.deepEqual(r.answer, INPUT)
  assert.equal(r.requests[0]!.headers["x-goog-api-key"], "test-key-google")
  assert.match(r.sessions[0]!, /^google:/)
  // Gemini 3.8 Flash: 5000 × $0.75 + 200 × $3.75, per million
  assert.deepEqual(r.costs, [{ model: "gemini-3.8-flash", inputTokens: 5000, outputTokens: 200, costUsd: 0.0045, costBasis: "estimate" }])

  const unknown = await runOn("google", "gemini-0-unknown")
  assert.deepEqual(unknown.costs, [{ model: "gemini-0-unknown", inputTokens: 5000, outputTokens: 200, costUsd: null, costBasis: "unknown" }])
})

test("OpenRouter: a bearer key, usage accounting asked for, Anthropic cache markers passed through, the reported cost", async () => {
  const r = await runOn("openrouter", "anthropic/claude-haiku-5.5")
  assert.deepEqual(r.answer, INPUT)
  assert.equal(r.requests[0]!.path, "/api/v1/chat/completions")
  assert.equal(r.requests[0]!.headers.authorization, "Bearer test-key-openrouter")
  assert.deepEqual(r.requests[0]!.body.usage, { include: true })
  assert.match(JSON.stringify(r.requests[0]!.body.messages), /"cache_control":\{"type":"ephemeral"\}/)
  assert.match(r.sessions[0]!, /^openrouter:/)
  assert.deepEqual(r.costs, [{ model: "anthropic/claude-haiku-5.5", inputTokens: 5000, outputTokens: 200, costUsd: 0.00123, costBasis: "reported" }])
})
