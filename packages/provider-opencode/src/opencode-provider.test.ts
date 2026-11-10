import { NodeServices } from "@effect/platform-node"
import { Effect, Exit, Layer, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { type AgentCost, type AgentError, type AgentHooks, type AgentTask, agentTool } from "@viral/provider-core"
import { makeOpencodeProvider, modelRef, runConfig } from "./opencode-provider.ts"
import { atLeast } from "./opencode-server.ts"
import { connectedIntegrations, opencodeStatus } from "./opencode-status.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-opencode-"))
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

const fake = join(import.meta.dirname, "fake-opencode.mjs")
type Entry = Record<string, unknown>
const run = <A>(name: string, use: Effect.Effect<A, AgentError, NodeServices.NodeServices | SecureRandom.SecureRandom>) => {
  const file = join(home, `${name}.jsonl`)
  process.env["FAKE_OPENCODE_LOG"] = file
  const log = () => readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Entry)
  return Effect.runPromiseExit(use.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, SecureRandom.layerWebCrypto)))).then((exit) => ({ exit, log }))
}
const go = <A>(script: unknown, hooks: AgentHooks, model: string | null, extra: Partial<AgentTask<typeof Answer>> = {}) =>
  Effect.flatMap(makeOpencodeProvider({ command: ["node", fake] }), (provider) => provider(task(script, extra), hooks, model, "SYSTEM")) as Effect.Effect<A, AgentError, NodeServices.NodeServices | SecureRandom.SecureRandom>

test("runs the helper, takes the result and interrupts the turn once its step has ended", async () => {
  const { hooks, costs, sessions, progress } = recorder()
  const script = { calls: [{ tool: "look_closer", args: { t: 3 } }, { tool: "propose_answer", args: { answer: 42 } }], end: "wait" }
  const { exit, log } = await run("ok", go(script, hooks, "zen/big"))
  assert.deepEqual(exit, Exit.succeed({ answer: 42 }))
  assert.deepEqual(sessions, ["ses_1"])
  assert.deepEqual(progress, ["Looking at it.", "→ look_closer", "→ propose_answer"])
  // two steps, from the session's totals: tokens with the cache, dollars as OpenCode reports
  assert.equal(costs.length, 1)
  assert.equal(costs[0]!.model, "zen/big")
  assert.equal(costs[0]!.inputTokens, 300)
  assert.equal(costs[0]!.outputTokens, 50)
  assert.ok(Math.abs((costs[0]!.costUsd ?? 0) - 0.004) < 1e-9)

  const entries = log()
  assert.deepEqual(entries.filter((e) => "tool" in e).map((e) => e["result"]), ["nothing new at 3", "Received. Stop here."])
  // the step that sent the result ends (and is paid for) before the interrupt
  const at = (key: string, value?: unknown) => entries.findIndex((e) => key in e && (value === undefined || e[key] === value))
  assert.ok(at("stepEnded", 1) >= 0 && at("stepEnded", 1) < at("interrupt", "ses_1"))
  const create = entries.find((e) => "create" in e)!["create"] as Entry
  assert.deepEqual([create["agent"], create["model"]], ["viral", { providerID: "zen", id: "big" }])
  assert.deepEqual(entries.find((e) => "prompt" in e)!["prompt"], { text: JSON.stringify(script) })
  const launch = entries[0]!
  assert.deepEqual((launch["argv"] as Array<string>).slice(0, 2), ["serve", "--hostname=127.0.0.1"])
  assert.deepEqual((launch["env"] as Entry)["claude"], "1")
  const config = launch["config"] as { agents: { viral: { system: string; permissions: unknown } }; permissions: unknown; default_agent: string }
  assert.equal(config.default_agent, "viral")
  assert.equal(config.agents.viral.system, "SYSTEM")
  assert.deepEqual(config.permissions, [
    { action: "*", resource: "*", effect: "deny" },
    { action: "viral_*", resource: "*", effect: "allow" }
  ])
  assert.deepEqual(config.agents.viral.permissions, config.permissions)
})

test("a resumed session moves into this run's folder and counts only this turn", async () => {
  const { hooks, costs, sessions } = recorder()
  const script = { calls: [{ tool: "propose_answer", args: { answer: 7 } }], end: "wait" }
  const { exit, log } = await run("resume", go(script, hooks, "zen/big", { resumeSession: "ses_9" }))
  assert.deepEqual(exit, Exit.succeed({ answer: 7 }))
  assert.deepEqual(sessions, ["ses_9"])
  assert.ok(Math.abs((costs[0]!.costUsd ?? 0) - 0.002) < 1e-9)
  assert.equal(costs[0]!.inputTokens, 150)
  const entries = log()
  assert.ok(!entries.some((e) => "create" in e))
  assert.match(String((entries.find((e) => "move" in e)!["move"] as Entry)["directory"]), /viral-opencode-/)
  assert.deepEqual(entries.find((e) => "agent" in e)!["agent"], { agent: "viral" })
  assert.deepEqual(entries.find((e) => "model" in e)!["model"], { model: { providerID: "zen", id: "big" } })
})

test("a finished turn without the output tool is no-output", async () => {
  const { hooks } = recorder()
  const { exit } = await run("none", go({ calls: [{ tool: "look_closer", args: { t: 1 } }], end: "complete" }, hooks, null))
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit.cause), /didn't call propose_answer/)
})

test("a failed execution ends the run with OpenCode's message", async () => {
  const { hooks } = recorder()
  const { exit } = await run("error", go({ calls: [], end: "error" }, hooks, "zen/big"))
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit.cause), /Insufficient balance/)
})

test("a retry only you can fix (out of credit) ends the run", async () => {
  const { hooks } = recorder()
  const { exit } = await run("retry", go({ calls: [], end: "retry" }, hooks, "zen/big"))
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit.cause), /Your free usage is over/)
})

test("OpenCode 1.x is refused with how to update", async () => {
  const { hooks } = recorder()
  process.env["FAKE_OPENCODE_VERSION"] = "1.19.5"
  const { exit } = await run("outdated", go({ calls: [], end: "complete" }, hooks, null))
  delete process.env["FAKE_OPENCODE_VERSION"]
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit.cause), /OpenCode 1\.19\.5 is older than 2\.2\.6.*OpenCode 2.*opencode upgrade/)
})

test("versions, model ids and the read permission", () => {
  assert.ok(atLeast("2.2.6", "2.2.6"))
  assert.ok(atLeast("2.10.0", "2.2.6"))
  assert.ok(!atLeast("1.19.5", "2.2.6"))
  assert.deepEqual(modelRef("vercel/anthropic/claude-haiku"), { providerID: "vercel", id: "anthropic/claude-haiku" })
  assert.equal(modelRef("haiku"), null)
  const endpoint = { url: "http://127.0.0.1:1/mcp", token: "t", name: "viral" }
  assert.ok(!runConfig({ system: "", endpoint, readDirs: [] }).permissions.some((rule) => rule.effect === "allow" && rule.action !== "viral_*"))
  assert.deepEqual(runConfig({ system: "", endpoint, readDirs: ["/sheets"] }).permissions, [
    { action: "*", resource: "*", effect: "deny" },
    { action: "read", resource: "/sheets/**", effect: "allow" },
    { action: "external_directory", resource: "/sheets/**", effect: "allow" },
    { action: "viral_*", resource: "*", effect: "allow" }
  ])
})

const status = (auth: string, version?: string) => {
  process.env["FAKE_OPENCODE_AUTH"] = auth
  if (version !== undefined) process.env["FAKE_OPENCODE_VERSION"] = version
  return run(`status-${auth}`, opencodeStatus(["node", fake])).then(({ exit, log }) => {
    delete process.env["FAKE_OPENCODE_AUTH"]
    delete process.env["FAKE_OPENCODE_VERSION"]
    assert.ok(Exit.isSuccess(exit))
    return { status: exit.value, log }
  })
}

test("status: a Console sign-in counts, and its opencode/* models with it", async () => {
  const { status: console, log } = await status("console")
  assert.deepEqual(console, { version: Option.some("2.2.6"), outdated: false, signedIn: true, models: ["opencode/claude-haiku-5-5", "opencode/big-pickle"] })
  // asked of a private server, not the background service
  assert.ok(log().every((e) => (e["argv"] as Array<string>).includes("--standalone")))
})

test("status: with nothing stored, Zen's free opencode/* models alone aren't signed in", async () => {
  assert.equal((await status("none")).status.signedIn, false)
  const key = (await status("key")).status
  assert.equal(key.signedIn, true)
  assert.ok(key.models.includes("vercel/anthropic/claude-haiku-5.5"))
})

test("status: OpenCode 1.x is outdated", async () => {
  const { status: old } = await status("console", "1.19.5")
  assert.deepEqual(old, { version: Option.some("1.19.5"), outdated: true, signedIn: false, models: [] })
  assert.deepEqual(connectedIntegrations("not json"), [])
})
