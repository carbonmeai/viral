import { NodeServices } from "@effect/platform-node"
import { MockLanguageModelV4 } from "ai/test"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect"
import type { CliEnvironment } from "@viral/provider-core"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { SkillPack } from "../agent-skills/skill-pack.ts"
import { CliSetups } from "../cli-setup/cli-setup.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Secrets } from "../secrets/secrets.ts"
import { writeFakeSecurity } from "../secrets/testing/fake-security.ts"
import { AppSettingsStore } from "../settings/app-settings.ts"
import { Settings } from "../settings/settings.ts"
import { AgentSession, type AgentTask, toolShape } from "./agent-session.ts"
import type { AgentCost, AgentRun } from "./agent-task.ts"
import type { ProjectId, RunId, StageRunId } from "@viral/contracts"
import type { StageContext } from "../runs/stages.ts"
import { runChecked } from "./run-checked.ts"

const Answer = Schema.Struct({ answer: Schema.Int, why: Schema.optionalKey(Schema.String) })

const task: AgentTask<typeof Answer> = {
  stage: "test",
  instructions: "Answer.",
  skills: [],
  message: "What is 6 × 7?",
  output: { tool: "propose_answer", description: "Submit the answer.", schema: Answer },
  defaultModel: null
}

// what AgentSession needs, with one fake Keychain in `dir` shared by the keys and the CLI setups
const sessionDeps = (dir: string) => {
  const base = Layer.mergeAll(NodeServices.layer, SkillPack.layer, Settings.layer, Secrets.layerWith({ security: writeFakeSecurity(dir) }), ViralHome.layer, SecureRandom.layerWebCrypto)
  return Layer.mergeAll(AppSettingsStore.layer, Layer.effect(CliSetups, CliSetups.make)).pipe(Layer.provideMerge(base))
}

const hooks = { progress: () => Effect.void, recordCost: () => Effect.void, recordSession: () => Effect.void }

test("the tool's input schema comes from the Effect Schema", () => {
  const shape = toolShape(Answer)
  assert.deepEqual(Object.keys(shape).sort(), ["answer", "why"])
  assert.equal(shape.answer!.safeParse(42).success, true)
  assert.equal(shape.answer!.safeParse("42").success, false)
  assert.equal(shape.why!.safeParse(undefined).success, true, "optional fields stay optional")
})

test("replay answers through the stage's schema", async () => {
  const ok = await Effect.runPromise(
    AgentSession.use((s) => s.run(task, hooks)).pipe(Effect.provide(AgentSession.replay(() => ({ answer: 42 }))))
  )
  assert.deepEqual(ok, { answer: 42 })

  const bad = await Effect.runPromiseExit(
    AgentSession.use((s) => s.run(task, hooks)).pipe(Effect.provide(AgentSession.replay(() => ({ answer: "lots" }))))
  )
  assert.match(JSON.stringify(bad), /invalid-output/)
})

test("a step set to a direct key provider runs there with that key; its cost is billed and marked an estimate", async () => {

  const dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-agent-session-")))
  const seen: Array<{ readonly provider: string; readonly model: string; readonly key: string }> = []
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "tool-call", toolCallId: "c1", toolName: "propose_answer", input: JSON.stringify({ answer: 42 }) }],
      finishReason: { unified: "tool-calls", raw: undefined },
      usage: { inputTokens: { total: 5000, noCache: 5000, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 200, text: 200, reasoning: undefined } },
      warnings: []
    })
  })
  const config = ConfigProvider.layer(ConfigProvider.fromUnknown({ VIRAL_HOME: join(dir, "home"), OPENAI_API_KEY: "test-openai-key-0001" }))
  const layer = Layer.effect(
    AgentSession,
    AgentSession.make({ keyModel: (provider, modelId, key) => (seen.push({ provider, model: modelId, key }), model) })
  ).pipe(Layer.provideMerge(sessionDeps(dir)), Layer.provideMerge(config))
  const rt = ManagedRuntime.make(layer)
  const costs: Array<unknown> = []
  try {
    const answer = await rt.runPromise(Effect.gen(function*() {
      const store = yield* AppSettingsStore
      yield* store.setStageAgent("metadata", { provider: "openai", model: "gpt-6-luna" })
      const session = yield* AgentSession
      return yield* session.run({ ...task, stage: "metadata" }, { ...hooks, recordCost: (cost) => Effect.sync(() => void costs.push(cost)) })
    }))
    assert.deepEqual(answer, { answer: 42 })
    assert.deepEqual(seen, [{ provider: "openai", model: "gpt-6-luna", key: "test-openai-key-0001" }])
    assert.deepEqual(costs, [{ model: "gpt-6-luna", inputTokens: 5000, outputTokens: 200, costUsd: 0.0006, costBasis: "estimate", provider: "openai", billing: "billed" }])
  } finally {
    await rt.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

// A stand-in CLI provider: records what each run was given (its environment) and answers with a cost.
const recordingCli = (seen: Array<{ readonly model: string | null; readonly cli: CliEnvironment | undefined }>, cost: Omit<AgentCost, "provider" | "billing">): AgentRun =>
  ((_task, runHooks, model, _system, cli) =>
    Effect.gen(function*() {
      seen.push({ model, cli })
      yield* runHooks.recordCost(cost)
      return { answer: 42 }
    })) as AgentRun

const cliSession = async <A, E>(
  env: Record<string, string>,
  use: Effect.Effect<A, E, AgentSession | AppSettingsStore | CliSetups | Secrets>,
  cost: Omit<AgentCost, "provider" | "billing"> = { model: "claude-haiku-5-5", inputTokens: 1000, outputTokens: 100, costUsd: 0.01 }
) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-agent-session-cli-")))
  const seen: Array<{ readonly model: string | null; readonly cli: CliEnvironment | undefined }> = []
  const run = recordingCli(seen, cost)
  const config = ConfigProvider.layer(ConfigProvider.fromUnknown({ VIRAL_HOME: join(dir, "home"), ...env }))
  const layer = Layer.effect(AgentSession, AgentSession.make({ cliRuns: { "claude-cli": run, codex: run, opencode: run } })).pipe(
    Layer.provideMerge(sessionDeps(dir)),
    Layer.provideMerge(config)
  )
  const rt = ManagedRuntime.make(layer)
  try {
    const exit = await rt.runPromiseExit(use)
    return { exit, seen, home: join(dir, "home") }
  } finally {
    await rt.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
}

const runStage = (stage: string, costs: Array<unknown>) =>
  AgentSession.use((session) =>
    session.run({ ...task, stage }, { ...hooks, recordCost: (cost) => Effect.sync(() => void costs.push(cost)) }))

test("the Claude CLI on your sign-in gets no extra variables and counts as your plan", async () => {
  const costs: Array<unknown> = []
  const { exit, seen } = await cliSession({}, runStage("ads", costs))
  assert.equal(exit._tag, "Success")
  assert.deepEqual(seen.map((s) => s.cli), [{ env: {}, apiKey: null }])
  assert.deepEqual(costs, [{ model: "claude-haiku-5-5", inputTokens: 1000, outputTokens: 100, costUsd: 0.01, provider: "claude-cli", billing: "subscription" }])
})

test("the Claude CLI on the OpenRouter preset gets the saved key as its token, in its own config folder, billed", async () => {
  const costs: Array<unknown> = []
  const { exit, seen, home } = await cliSession({}, Effect.gen(function*() {
    const secrets = yield* Secrets
    yield* secrets.set("openrouter", Redacted.make("test-openrouter-key-0042"))
    const setups = yield* CliSetups
    const setup = yield* setups.setPreset("claude", "claude-openrouter")
    assert.equal(setup.billing, "billed")
    assert.equal(setup.using, "Using your OpenRouter key")
    assert.ok(!JSON.stringify(setup).includes("test-openrouter-key-0042"), "the view never carries the key")
    return yield* runStage("script", costs)
  }))
  assert.equal(exit._tag, "Success")
  assert.deepEqual(seen[0]!.cli, {
    env: {
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: "test-openrouter-key-0042",
      ANTHROPIC_API_KEY: "",
      CLAUDE_CONFIG_DIR: join(home, "cli", "claude-openrouter")
    },
    apiKey: null
  })
  // through a router the CLI prices every model at Anthropic's rates: an estimate
  assert.deepEqual(costs, [{ model: "claude-haiku-5-5", inputTokens: 1000, outputTokens: 100, costUsd: 0.01, costBasis: "estimate", provider: "claude-cli", billing: "billed" }])
})

test("a preset whose key isn't saved fails the run with what to do", async () => {
  const { exit, seen } = await cliSession({}, Effect.gen(function*() {
    yield* (yield* CliSetups).setPreset("claude", "claude-anthropic")
    return yield* runStage("ads", [])
  }))
  assert.equal(exit._tag, "Failure")
  assert.match(JSON.stringify(exit), /no-key/)
  assert.match(JSON.stringify(exit), /Anthropic key/)
  assert.equal(seen.length, 0)
})

test("Codex on the OpenAI preset signs in with the saved key in its own folder; its tokens are priced and billed", async () => {
  const costs: Array<unknown> = []
  const { exit, seen, home } = await cliSession({}, Effect.gen(function*() {
    yield* (yield* Secrets).set("openai", Redacted.make("test-openai-key-0007"))
    yield* (yield* CliSetups).setPreset("codex", "codex-openai")
    yield* (yield* AppSettingsStore).setStageAgent("metadata", { provider: "codex", model: "gpt-6-luna" })
    return yield* runStage("metadata", costs)
  }), { model: "gpt-6-luna", inputTokens: 5000, outputTokens: 200, costUsd: 0 })
  assert.equal(exit._tag, "Success")
  const cli = seen[0]!.cli!
  assert.deepEqual(cli.env, {})
  assert.equal(cli.apiKey?.home, join(home, "cli", "codex-openai"))
  assert.equal(Redacted.value(cli.apiKey!.key), "test-openai-key-0007")
  assert.deepEqual(costs, [{ model: "gpt-6-luna", inputTokens: 5000, outputTokens: 200, costUsd: 0.0006, costBasis: "estimate", provider: "codex", billing: "billed" }])
})

test("OpenCode gets your keys only when you share them", async () => {
  const { seen } = await cliSession({}, Effect.gen(function*() {
    yield* (yield* Secrets).set("anthropic", Redacted.make("test-anthropic-key-0001"))
    yield* (yield* AppSettingsStore).setStageAgent("ads", { provider: "opencode", model: "anthropic/claude-haiku-5-5" })
    yield* runStage("ads", [])
    yield* (yield* CliSetups).setPreset("opencode", "opencode-keys")
    return yield* runStage("ads", [])
  }))
  assert.deepEqual(seen.map((s) => s.cli?.env), [{}, { ANTHROPIC_API_KEY: "test-anthropic-key-0001" }])
})

test("your own variables reach the CLI, a secret one read from the Keychain", async () => {
  const costs: Array<unknown> = []
  const { seen } = await cliSession({}, Effect.gen(function*() {
    const setups = yield* CliSetups
    yield* setups.setVar("claude", "ANTHROPIC_AUTH_TOKEN", "test-router-token-0009", true)
    yield* setups.setVar("claude", "ANTHROPIC_BASE_URL", "https://router.example/api", false)
    return yield* runStage("ads", costs)
  }))
  assert.deepEqual(seen[0]!.cli?.env, { ANTHROPIC_AUTH_TOKEN: "test-router-token-0009", ANTHROPIC_BASE_URL: "https://router.example/api" })
  assert.equal((costs[0] as { billing: string }).billing, "billed")
})

// A conversation lives with the provider that had it. A step moved to another provider starts afresh with the brief,
// the version your note is about and the note; a model change on the same provider continues the conversation, on the
// new model.
const resumingCli = (seen: Array<{ readonly model: string | null; readonly resume: string | null; readonly message: string }>): AgentRun =>
  ((runTask, runHooks, model) =>
    Effect.gen(function*() {
      seen.push({ model, resume: runTask.resumeSession ?? null, message: runTask.message })
      yield* runHooks.recordCost({ model, inputTokens: 10, outputTokens: 1, costUsd: 0 })
      return { answer: 42 }
    })) as AgentRun

const resumeSession = async (stageAgent: { readonly provider: "codex" | "claude-cli"; readonly model: string }, resumeProvider: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-agent-session-resume-")))
  const seen: Array<{ readonly model: string | null; readonly resume: string | null; readonly message: string }> = []
  const run = resumingCli(seen)
  const config = ConfigProvider.layer(ConfigProvider.fromUnknown({ VIRAL_HOME: join(dir, "home") }))
  const layer = Layer.effect(AgentSession, AgentSession.make({ cliRuns: { "claude-cli": run, codex: run, opencode: run } })).pipe(
    Layer.provideMerge(sessionDeps(dir)),
    Layer.provideMerge(config)
  )
  const rt = ManagedRuntime.make(layer)
  const ctx: StageContext = {
    owner: { _tag: "Project", id: "p1" as ProjectId },
    runId: "r1" as RunId,
    stageRunId: "s1" as StageRunId,
    attempt: 2,
    note: "shorter title",
    resumeSession: "old-session",
    resumeProvider,
    previous: JSON.stringify({ answer: 41 }),
    recordSession: () => Effect.void,
    recordReply: () => Effect.void,
    progress: () => Effect.void,
    recordCost: () => Effect.void
  }
  try {
    const exit = await rt.runPromiseExit(Effect.gen(function*() {
      yield* (yield* AppSettingsStore).setStageAgent("metadata", stageAgent)
      const agent = yield* AgentSession
      return yield* runChecked(agent, ctx, { ...task, stage: "metadata", brief: "BRIEF" }, (value) => Effect.succeed({ value, problems: [] }))
    }))
    return { exit, seen }
  } finally {
    await rt.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
}

test("a revision on a step moved to another provider starts afresh with the brief, its last version and the note", async () => {
  const { exit, seen } = await resumeSession({ provider: "codex", model: "gpt-6-luna" }, "claude-cli")
  assert.equal(exit._tag, "Success")
  assert.equal(seen.length, 1, "the old session never reaches the new provider")
  assert.equal(seen[0]!.resume, null)
  assert.equal(seen[0]!.model, "gpt-6-luna")
  assert.match(seen[0]!.message, /^BRIEF\n\nYour last version, as the app stored it:\n\{"answer":41\}\n\nNote from the reviewer on the last version: shorter title$/)
})

test("a revision on the same provider with another model continues the conversation on the step's model", async () => {
  const { exit, seen } = await resumeSession({ provider: "claude-cli", model: "haiku" }, "claude-cli")
  assert.equal(exit._tag, "Success")
  assert.deepEqual(seen.map((s) => [s.resume, s.model]), [["old-session", "haiku"]])
  assert.match(seen[0]!.message, /^Revise it: shorter title/)
})
