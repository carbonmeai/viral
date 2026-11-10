import { NodeServices } from "@effect/platform-node"
import type { KeyProvider } from "@viral/contracts"
import { type AgentHooks, type AgentTask, agentTool, toolAnswer } from "@viral/provider-core"
import type { ModelMessage } from "ai"
import { Effect, Layer, Redacted, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { stepMessages } from "./ai-sdk-images.ts"
import { makeAiSdkProvider } from "./ai-sdk-provider.ts"

// The images a helper tool draws reach each vendor's real API in the shape that vendor takes: the real AI SDK
// factory against a fake server that first asks for the helper (`look`, which draws one image), then, once the
// tool's answer is in the request, submits through the output tool. The second request is the one checked.

// a 1×1 PNG
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const PNG = Buffer.from(PNG_BASE64, "base64")
const LOOKED = "LOOKED-AT-THE-FRAME"
const INPUT = { answer: 42 }

let server: Server
let base: string
let home: string
let frames: string
const bodies: Array<{ readonly path: string; readonly body: Record<string, unknown> }> = []

// One vendor's answer: ask for the helper first; once its result is in the request, call the output tool.
const answer = (path: string, body: Record<string, unknown>, raw: string): unknown => {
  const looked = raw.includes(LOOKED)
  const name = looked ? "propose_answer" : "look"
  const args = looked ? INPUT : { at: 3 }
  if (path === "/v1/messages") {
    return {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "tool_use", id: looked ? "toolu_2" : "toolu_1", name, input: args }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 20 }
    }
  }
  if (path === "/v1/responses") {
    return {
      id: "resp_1",
      object: "response",
      created_at: 1_790_000_000,
      model: body.model,
      status: "completed",
      output: [{ type: "function_call", id: looked ? "fc_2" : "fc_1", call_id: looked ? "call_2" : "call_1", name, arguments: JSON.stringify(args), status: "completed" }],
      usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1020 }
    }
  }
  if (path.startsWith("/v1beta/models/")) {
    return {
      candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 20, totalTokenCount: 1020 }
    }
  }
  if (path === "/api/v1/chat/completions") {
    return {
      id: "gen-1",
      object: "chat.completion",
      created: 1_790_000_000,
      model: body.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "", tool_calls: [{ id: looked ? "call_2" : "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }] },
        finish_reason: "tool_calls"
      }],
      usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020, cost: 0.0001 }
    }
  }
  // the AI Gateway's language-model endpoint answers with the model's result itself
  return {
    content: [{ type: "tool-call", toolCallId: looked ? "c2" : "c1", toolName: name, input: JSON.stringify(args) }],
    finishReason: { unified: "tool-calls", raw: "tool_calls" },
    usage: { inputTokens: { total: 1000, noCache: 1000 }, outputTokens: { total: 20, text: 20 } },
    providerMetadata: { gateway: { cost: "0.0001" } },
    warnings: []
  }
}

before(async () => {
  home = mkdtempSync(join(tmpdir(), "viral-ai-sdk-images-"))
  frames = join(home, "frames")
  mkdirSync(frames)
  writeFileSync(join(frames, "shot-01.png"), PNG)
  server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => raw += chunk)
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0] ?? ""
      const body = raw === "" ? {} : JSON.parse(raw) as Record<string, unknown>
      bodies.push({ path, body })
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer(path, body, raw)))
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
const look = () =>
  agentTool({
    name: "look",
    description: "Draw a frame.",
    schema: Schema.Struct({ at: Schema.Finite }),
    run: () => Effect.succeed(toolAnswer(`${LOOKED}: ${join(frames, "shot-01.png")}`, [join(frames, "shot-01.png")]))
  })
const task = (): AgentTask<typeof Answer> => ({
  stage: "test",
  instructions: "Answer.",
  skills: [],
  message: "Look, then answer.",
  output: { tool: "propose_answer", description: "Submit the answer.", schema: Answer },
  defaultModel: null,
  tools: [look()]
})
const hooks: AgentHooks = { progress: () => Effect.void, recordCost: () => Effect.void, recordSession: () => Effect.void }

// the request that carried the helper's answer
const runOn = async (provider: KeyProvider, model: string) => {
  const from = bodies.length
  const result = await Effect.runPromise(
    makeAiSdkProvider({ provider, apiKey: Effect.succeedSome(Redacted.make("test-key")), sessionsDir: join(home, "sessions"), baseUrl: base }).pipe(
      Effect.flatMap((run) => run(task(), hooks, model, "Answer.")),
      Effect.provide(Layer.mergeAll(NodeServices.layer, SecureRandom.layerWebCrypto))
    )
  )
  assert.deepEqual(result, INPUT)
  const sent = bodies.slice(from)
  assert.equal(sent.length, 2, "one call for the helper, one for the answer")
  return sent[1]!.body
}

const find = (value: unknown, match: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) return value.flatMap((v) => find(v, match))
  if (typeof value !== "object" || value === null) return []
  const node = value as Record<string, unknown>
  return [...(match(node) ? [node] : []), ...Object.values(node).flatMap((v) => find(v, match))]
}

test("Anthropic: the image is an image block inside the tool_result", async () => {
  const body = await runOn("anthropic", "claude-haiku-5-5")
  const [result] = find(body.messages, (n) => n.type === "tool_result")
  assert.ok(result !== undefined, "a tool_result was sent")
  assert.deepEqual(find(result.content, (n) => n.type === "image"), [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_BASE64 } }])
  assert.match(JSON.stringify(result.content), new RegExp(LOOKED))
})

test("OpenAI: the image is an input_image inside the Responses function_call_output", async () => {
  const body = await runOn("openai", "gpt-6-luna")
  const [output] = find(body.input, (n) => n.type === "function_call_output")
  assert.ok(output !== undefined && Array.isArray(output.output), "the output is a list of parts")
  assert.deepEqual(find(output.output, (n) => n.type === "input_image").map((n) => n.image_url), [`data:image/png;base64,${PNG_BASE64}`])
})

test("Google: the image is inlineData inside the functionResponse (Gemini 3)", async () => {
  const body = await runOn("google", "gemini-3.8-flash")
  const [response] = find(body.contents, (n) => "functionResponse" in n).map((n) => n.functionResponse as Record<string, unknown>)
  assert.ok(response !== undefined, "a functionResponse was sent")
  assert.deepEqual(find(response.parts, (n) => "inlineData" in n), [{ inlineData: { mimeType: "image/png", data: PNG_BASE64 } }])
})

test("OpenRouter: the tool message keeps the text and the image follows in a user message", async () => {
  const body = await runOn("openrouter", "google/gemini-3.8-flash")
  const messages = body.messages as Array<Record<string, unknown>>
  const toolAt = messages.findIndex((m) => m.role === "tool")
  assert.ok(toolAt > 0, "a tool message was sent")
  assert.doesNotMatch(JSON.stringify(messages[toolAt]), /image_url/, "no image in the tool message")
  const next = messages[toolAt + 1]!
  assert.equal(next.role, "user")
  assert.deepEqual(find(next.content, (n) => n.type === "image_url"), [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } }])
})

test("AI Gateway: the image travels as a file part inside the tool result, base64-encoded", async () => {
  const body = await runOn("ai-gateway", "anthropic/claude-haiku-5.5")
  const [result] = find(body.prompt, (n) => n.type === "tool-result")
  assert.ok(result !== undefined, "a tool-result was sent")
  const [file] = find(result.output, (n) => n.type === "file")
  assert.deepEqual({ mediaType: file?.mediaType, data: file?.data }, { mediaType: "image/png", data: { type: "data", data: PNG_BASE64 } })
})

// tool results with images, oldest first
const withImages = (count: number): Array<ModelMessage> =>
  Array.from({ length: count }, (_, k): ModelMessage => ({
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: `c${k}`,
      toolName: "look",
      output: {
        type: "content",
        value: [{ type: "text", text: `look ${k}` }, { type: "file", mediaType: "image/png", filename: `/f/${k}.png`, data: { type: "data", data: new Uint8Array([k]) } }]
      }
    }]
  }))

const parts = (messages: ReadonlyArray<ModelMessage>) => JSON.stringify(messages)

test("only the newest tool images stay in what a step sends; older ones say how to see them again", () => {
  const sent = stepMessages(withImages(4), "in-result", 2)
  const json = parts(sent)
  assert.match(json, /\/f\/0\.png is no longer attached; call view_image/)
  assert.match(json, /\/f\/1\.png is no longer attached/)
  assert.doesNotMatch(json, /\/f\/2\.png is no longer/)
  assert.equal((json.match(/"type":"file"/g) ?? []).length, 2)
  assert.deepEqual(stepMessages(sent, "in-result", 2), sent, "applying it again changes nothing")
})

test("on a user-message vendor the kept images move into a user message after their tool result", () => {
  const sent = stepMessages(withImages(3), "user-message", 2)
  assert.deepEqual(sent.map((m) => m.role), ["tool", "tool", "user", "tool", "user"])
  assert.doesNotMatch(parts(sent.filter((m) => m.role === "tool")), /"type":"file"/)
  assert.match(parts([sent[2]!]), /"type":"file"/)
})
