import { NodeServices } from "@effect/platform-node"
import { MockLanguageModelV4 } from "ai/test"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { SkillPack } from "../agent-skills/skill-pack.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Secrets } from "../secrets/secrets.ts"
import { makeAiGatewayProvider } from "./ai-gateway-provider.ts"
import { type AgentError, type AgentHooks, type AgentRun, type AgentTask, agentTool } from "./agent-task.ts"

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0]
type Content = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>["content"][number]

let home: string
let sheets: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-gateway-"))
  sheets = join(home, "sheets")
  mkdirSync(sheets)
  writeFileSync(join(sheets, "sheet_000.png"), new Uint8Array([137, 80, 78, 71]))
  writeFileSync(join(sheets, "notes.txt"), "not an image")
})
after(() => rmSync(home, { recursive: true, force: true }))

const Answer = Schema.Struct({ answer: Schema.Int })
const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } }
const reply = (content: Array<Content>, cost: string, marketCost?: string) => ({
  content,
  finishReason: { unified: content.some((c) => c.type === "tool-call") ? "tool-calls" as const : "stop" as const, raw: undefined },
  usage,
  providerMetadata: { gateway: marketCost === undefined ? { cost } : { cost, marketCost } },
  warnings: []
})
const call = (id: string, name: string, input: unknown): Content => ({ type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) })

// A gateway model that plays the given steps in order and records what it was sent.
const scripted = (steps: Array<ReturnType<typeof reply>>) => {
  const calls: Array<CallOptions> = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options)
      return steps[calls.length - 1] ?? steps.at(-1)!
    }
  })
  return { calls, model }
}

const recorded = () => {
  const costs: Array<{ model: string | null; inputTokens: number; outputTokens: number; costUsd: number }> = []
  const sessions: Array<string> = []
  const hooks: AgentHooks = {
    progress: () => Effect.void,
    recordCost: (cost) => Effect.sync(() => void costs.push(cost)),
    recordSession: (id) => Effect.sync(() => void sessions.push(id))
  }
  return { costs, sessions, hooks }
}

const layers = (key: string | undefined) =>
  Layer.mergeAll(
    NodeServices.layer,
    SkillPack.layer,
    ViralHome.layer,
    Secrets.layerWith({ security: join(home, "no-such-security") }),
    SecureRandom.layerWebCrypto
  ).pipe(Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown({
    VIRAL_HOME: home,
    HOME: home,
    ...(key === undefined ? {} : { AI_GATEWAY_API_KEY: key })
  }))))

const run = <A>(model: MockLanguageModelV4, key: string | undefined, use: (go: AgentRun) => Effect.Effect<A, AgentError>) =>
  Effect.runPromise(makeAiGatewayProvider({ languageModel: () => model }).pipe(
    Effect.flatMap(use),
    Effect.provide(layers(key))
  ))

const taskFor = (): AgentTask<typeof Answer> => ({
  stage: "test",
  instructions: "Answer.",
  skills: [],
  message: "What is 6 × 7?",
  output: { tool: "propose_answer", description: "Submit the answer.", schema: Answer },
  defaultModel: null,
  readDirs: [sheets]
})

test("a gateway run sends the brief with its images, stops at the output tool, and records cost and session", async () => {
  let helped = 0
  const helper = agentTool({
    name: "look_closer",
    description: "Look closer.",
    schema: Schema.Struct({ at: Schema.Finite }),
    run: ({ at }) => Effect.sync(() => {
      helped++
      return `nothing new at ${at}`
    })
  })
  const { calls, model } = scripted([
    // with your own Anthropic key the gateway charges nothing and Anthropic bills the market cost
    reply([call("c1", "look_closer", { at: 3 })], "0", "0.002"),
    reply([call("c2", "propose_answer", { answer: 42 })], "0.0005"),
    reply([{ type: "text", text: "Done!" }], "0.1")
  ])
  const r = recorded()
  const answer = await run(model, "test-key", (go) => go({ ...taskFor(), tools: [helper] }, r.hooks, "anthropic/claude-haiku-4.5"))

  assert.deepEqual(answer, { answer: 42 })
  assert.equal(calls.length, 2, "the output tool's call ends the run; no wasted turn")
  assert.equal(helped, 1)
  assert.deepEqual(r.costs, [{ model: "anthropic/claude-haiku-4.5", inputTokens: 200, outputTokens: 40, costUsd: 0.0025 }])
  assert.match(r.sessions[0]!, /^gateway:/)

  // what the model was sent: the skills prompt cached, the brief with only the image file attached
  const prompt = calls[0]!.prompt
  assert.equal(prompt[0]!.role, "system")
  assert.deepEqual(prompt[0]!.providerOptions, { anthropic: { cacheControl: { type: "ephemeral" } } })
  const user = prompt[1]!
  assert.ok(user.role === "user")
  assert.deepEqual(user.content.map((p: { readonly type: string }) => p.type), ["text", "text", "file"])
  assert.equal(calls[0]!.tools?.map((t: { readonly name: string }) => t.name).sort().join(","), "look_closer,propose_answer")
})

test("a resumed run continues the stored conversation with the note", async () => {
  const first = scripted([reply([call("c1", "propose_answer", { answer: 41 })], "0.001")])
  const r = recorded()
  await run(first.model, "test-key", (go) => go(taskFor(), r.hooks, "openai/gpt-6-luna"))
  const session = r.sessions[0]!
  const stored = JSON.parse(readFileSync(join(home, "agent-sessions", `${session.slice("gateway:".length)}.json`), "utf8"))
  assert.equal(stored.at(-1).role, "tool", "the output call is answered, so the history can continue")
  assert.ok(JSON.stringify(stored).includes("sheet_000.png") && !JSON.stringify(stored).includes("\"image\":{"), "images are stored as files")

  const second = scripted([reply([call("c9", "propose_answer", { answer: 42 })], "0.001")])
  const again = recorded()
  const answer = await run(second.model, "test-key", (go) => go({ ...taskFor(), message: "Off by one.", resumeSession: session }, again.hooks, "openai/gpt-6-luna"))
  assert.deepEqual(answer, { answer: 42 })
  assert.deepEqual(again.sessions, [session], "the same conversation")
  const sent = second.calls[0]!.prompt
  assert.deepEqual(sent.map((m: { readonly role: string }) => m.role), ["system", "user", "assistant", "tool", "user"])
  assert.equal(sent[0]!.providerOptions, undefined, "only Anthropic models get cache markers")
})

test("no output call, no model or no key are clear errors", async () => {
  const silent = scripted([reply([{ type: "text", text: "Here is my answer: 42" }], "0.001")])
  const noCall = await Effect.runPromiseExit(Effect.provide(
    makeAiGatewayProvider({ languageModel: () => silent.model }).pipe(Effect.flatMap((go) => go(taskFor(), recorded().hooks, "openai/gpt-6-luna"))),
    layers("test-key")
  ))
  assert.match(JSON.stringify(noCall), /no-output.*Here is my answer/)

  const noModel = await Effect.runPromiseExit(Effect.provide(
    makeAiGatewayProvider({ languageModel: () => silent.model }).pipe(Effect.flatMap((go) => go(taskFor(), recorded().hooks, null))),
    layers("test-key")
  ))
  assert.match(JSON.stringify(noModel), /no-model/)

  const noKey = await Effect.runPromiseExit(Effect.provide(
    makeAiGatewayProvider({ languageModel: () => silent.model }).pipe(Effect.flatMap((go) => go(taskFor(), recorded().hooks, "openai/gpt-6-luna"))),
    layers(undefined)
  ))
  assert.match(JSON.stringify(noKey), /no-key/)
})
