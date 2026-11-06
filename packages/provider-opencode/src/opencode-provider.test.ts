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
import { credentialCount, opencodeStatus } from "./opencode-status.ts"

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

test("runs the helper, takes the result and aborts the session", async () => {
  const { hooks, costs, sessions, progress } = recorder()
  const script = { calls: [{ tool: "look_closer", args: { t: 3 } }, { tool: "propose_answer", args: { answer: 42 } }], end: "wait" }
  const { exit, log } = await run("ok", go(script, hooks, "zen/big"))
  assert.deepEqual(exit, Exit.succeed({ answer: 42 }))
  assert.deepEqual(sessions, ["ses_1"])
  assert.deepEqual(progress, ["Looking at it.", "→ look_closer", "→ propose_answer"])
  // three answers (two tool steps and the aborted last one): tokens with the cache, dollars as OpenCode reports
  assert.equal(costs.length, 1)
  assert.equal(costs[0]!.model, "zen/big")
  assert.equal(costs[0]!.inputTokens, 450)
  assert.equal(costs[0]!.outputTokens, 75)
  assert.ok(Math.abs(costs[0]!.costUsd - 0.006) < 1e-9)

  const entries = log()
  assert.deepEqual(entries.filter((e) => "tool" in e).map((e) => e["result"]), ["nothing new at 3", "Received. Stop here."])
  assert.ok(entries.some((e) => e["abort"] === "ses_1"))
  assert.deepEqual(entries.find((e) => "prompt" in e)!["prompt"], { agent: "viral", model: { providerID: "zen", modelID: "big" } })
  const launch = entries[0]!
  assert.deepEqual((launch["env"] as Entry)["claude"], "1")
  const config = launch["config"] as { agent: { viral: { prompt: string } }; permission: Entry }
  assert.equal(config.agent.viral.prompt, "SYSTEM")
  assert.equal(config.permission["bash"], "deny")
  assert.equal(config.permission["viral_*"], "allow")
})

test("a resumed session counts only this turn", async () => {
  const { hooks, costs, sessions } = recorder()
  const script = { calls: [{ tool: "propose_answer", args: { answer: 7 } }], end: "wait" }
  const { exit } = await run("resume", go(script, hooks, null, { resumeSession: "ses_9" }))
  assert.deepEqual(exit, Exit.succeed({ answer: 7 }))
  assert.deepEqual(sessions, ["ses_9"])
  assert.ok(costs[0]!.costUsd < 0.01)
})

test("a session error ends the run even though the prompt never answers", async () => {
  const { hooks } = recorder()
  const { exit } = await run("error", go({ calls: [], end: "error" }, hooks, "zen/big"))
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit.cause), /Free usage limit reached/)
})

test("an outdated OpenCode is refused with how to update", async () => {
  const { hooks } = recorder()
  process.env["FAKE_OPENCODE_VERSION"] = "1.1.12"
  const { exit } = await run("outdated", go({ calls: [], end: "complete" }, hooks, null))
  delete process.env["FAKE_OPENCODE_VERSION"]
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit.cause), /OpenCode 1\.1\.12 is older than 1\.14\.19.*opencode upgrade/)
})

test("versions, model ids and the read permission", () => {
  assert.ok(atLeast("1.14.19", "1.14.19"))
  assert.ok(atLeast("1.19.5", "1.14.19"))
  assert.ok(!atLeast("1.1.12", "1.14.19"))
  assert.deepEqual(modelRef("openrouter/anthropic/claude-haiku"), { providerID: "openrouter", modelID: "anthropic/claude-haiku" })
  assert.equal(modelRef("haiku"), null)
  const endpoint = { url: "http://127.0.0.1:1/mcp", token: "t", name: "viral" }
  assert.equal(runConfig({ system: "", endpoint, readDirs: [] }).permission.read, "deny")
  assert.deepEqual(runConfig({ system: "", endpoint, readDirs: ["/sheets"] }).permission.read, { "*": "deny", "/sheets/**": "allow" })
})

test("status: version, sign-in and models", async () => {
  const status = await Effect.runPromise(opencodeStatus(["node", fake]).pipe(Effect.provide(NodeServices.layer)))
  assert.deepEqual(status, { version: Option.some("1.14.19"), outdated: false, signedIn: true, models: ["opencode/big-pickle", "anthropic/claude-haiku-5.5"] })
  process.env["FAKE_OPENCODE_VERSION"] = "1.1.12"
  const old = await Effect.runPromise(opencodeStatus(["node", fake]).pipe(Effect.provide(NodeServices.layer)))
  delete process.env["FAKE_OPENCODE_VERSION"]
  assert.equal(old.outdated, true)
  assert.equal(credentialCount("\u001b[0m└  0 credentials"), 0)
  assert.equal(credentialCount("└  2 credentials"), 2)
})
