import { NodeServices } from "@effect/platform-node"
import { Effect, Exit, Layer, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentError, type AgentCost, type AgentHooks, type AgentTask, agentTool } from "@viral/provider-core"
import { configuredMcpServers, launchArgs, makeCodexProvider } from "./codex-provider.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-codex-"))
  writeFileSync(join(home, "config.toml"), `model = "x"\n\n[mcp_servers.mine]\ncommand = "mine"\n`)
})
after(() => rmSync(home, { recursive: true, force: true }))

const Answer = Schema.Struct({ answer: Schema.Int })
const task = (script: unknown, extra: Partial<AgentTask<typeof Answer>> = {}): AgentTask<typeof Answer> => ({
  stage: "test",
  instructions: "",
  skills: [],
  message: JSON.stringify(script),
  output: { tool: "propose_answer", description: "the answer", schema: Answer },
  defaultModel: null,
  tools: [agentTool({
    name: "look_closer",
    description: "look closer",
    schema: Schema.Struct({ t: Schema.Number }),
    run: ({ t }) => Effect.succeed(`nothing new at ${t}`)
  })],
  ...extra
})

const recorder = () => {
  const costs: Array<AgentCost> = []
  const sessions: Array<string> = []
  const progress: Array<string> = []
  const hooks: AgentHooks = {
    progress: (_pct, message) => Effect.sync(() => void (message && progress.push(message))),
    recordCost: (cost) => Effect.sync(() => void costs.push(cost)),
    recordSession: (id) => Effect.sync(() => void sessions.push(id))
  }
  return { hooks, costs, sessions, progress }
}

const fake = join(import.meta.dirname, "fake-codex-app-server.mjs")
const run = <A>(name: string, use: (log: () => Array<Record<string, unknown>>) => Effect.Effect<A, AgentError, NodeServices.NodeServices | SecureRandom.SecureRandom>) => {
  const file = join(home, `${name}.jsonl`)
  process.env["FAKE_CODEX_LOG"] = file
  const log = () => readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  return Effect.runPromiseExit(use(log).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, SecureRandom.layerWebCrypto))))
}
const provider = Effect.suspend(() => makeCodexProvider({ command: ["node", fake], codexHome: home }))

test("runs the helper, takes the result and interrupts the turn", async () => {
  const { hooks, costs, sessions, progress } = recorder()
  let entries: Array<Record<string, unknown>> = []
  const exit = await run("ok", (log) =>
    Effect.gen(function*() {
      const go = yield* provider
      const script = { calls: [{ tool: "look_closer", args: { t: 3 } }, { tool: "propose_answer", args: { answer: 42 } }], end: "wait" }
      const result = yield* go(task(script), hooks, null, "SYSTEM")
      entries = log()
      return result
    }))
  assert.deepEqual(exit, Exit.succeed({ answer: 42 }))
  assert.deepEqual(sessions, ["thread-1"])
  assert.deepEqual(progress, ["Looking at it.", "→ look_closer", "→ propose_answer"])
  // only this turn's tokens: the thread's total minus what it had before
  assert.deepEqual(costs, [{ model: "gpt-big", inputTokens: 300, outputTokens: 50, costUsd: 0 }])

  const results = entries.filter((entry) => "tool" in entry).map((entry) => entry["result"])
  assert.deepEqual(results, ["nothing new at 3", "Received. Stop here."])
  const requests = entries.flatMap((entry) => "request" in entry ? [entry["request"] as { method?: string; params?: Record<string, unknown> }] : [])
  assert.ok(requests.some((request) => request.method === "turn/interrupt"))
  const start = requests.find((request) => request.method === "thread/start")!.params!
  assert.equal(start["baseInstructions"], "SYSTEM")
  assert.equal(start["approvalPolicy"], "never")
  assert.equal(start["sandbox"], "read-only")
  assert.equal(start["model"], "gpt-big")
  const config = start["config"] as Record<string, Record<string, unknown>>
  assert.equal(config["model_reasoning_effort"], "medium" as never)
  assert.equal(config["mcp_servers.viral"]!["default_tools_approval_mode"], "approve")

  // isolated: the user's own MCP server is switched off, the plugin's isn't named (plugins are off)
  const argv = entries[0]!["argv"] as Array<string>
  assert.ok(argv.includes("mcp_servers.mine.enabled=false"))
  assert.ok(!argv.some((arg) => arg.includes("plugin-one")))
  assert.ok(argv.includes("shell_tool") && argv.includes("view_image"))
})

test("a resumed thread keeps its id and sends the note", async () => {
  const { hooks, sessions } = recorder()
  const exit = await run("resume", () =>
    Effect.gen(function*() {
      const go = yield* provider
      const script = { calls: [{ tool: "propose_answer", args: { answer: 7 } }], end: "wait" }
      return yield* go(task(script, { resumeSession: "thread-9" }), hooks, "gpt-small", "SYSTEM")
    }))
  assert.deepEqual(exit, Exit.succeed({ answer: 7 }))
  assert.deepEqual(sessions, ["thread-9"])
})

test("a bad answer goes back to the model, and a turn that ends without one fails", async () => {
  const { hooks } = recorder()
  let entries: Array<Record<string, unknown>> = []
  const exit = await run("bad", (log) =>
    Effect.gen(function*() {
      const go = yield* provider
      const script = { calls: [{ tool: "propose_answer", args: { answer: 1.5 } }], end: "complete" }
      return yield* go(task(script), hooks, null, "SYSTEM").pipe(Effect.ensuring(Effect.sync(() => void (entries = log()))))
    }))
  assert.match(String(entries.find((entry) => "tool" in entry)?.["result"]), /Invalid arguments|doesn't match the expected format/)
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit.cause), /didn't call propose_answer/)
})

test("a failed turn and an unknown model are reported", async () => {
  const { hooks } = recorder()
  const failed = await run("failed", () =>
    Effect.gen(function*() {
      const go = yield* provider
      return yield* go(task({ calls: [], end: "fail" }), hooks, null, "SYSTEM")
    }))
  assert.ok(Exit.isFailure(failed))
  assert.match(String(failed.cause), /usage limit reached/)

  const unknown = await run("unknown", () =>
    Effect.gen(function*() {
      const go = yield* provider
      return yield* go(task({ calls: [], end: "complete" }), hooks, "gpt-nope", "SYSTEM")
    }))
  assert.ok(Exit.isFailure(unknown))
  assert.match(String(unknown.cause), /doesn't offer gpt-nope.*gpt-big, gpt-small/)
})

test("launch arguments and the user's configured MCP servers", () => {
  assert.deepEqual([...configuredMcpServers(`[mcp_servers.a]\nx=1\n[mcp_servers.a.env]\n[mcp_servers."b-c"]\n`)], ["a", "b-c"])
  const args = launchArgs(["a"], true)
  assert.ok(!args.includes("view_image"))
  assert.ok(args.includes(`web_search="disabled"`))
})
