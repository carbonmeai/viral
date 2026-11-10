import { NodeServices } from "@effect/platform-node"
import { Effect, Exit, Schema } from "effect"
import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import type { AgentHooks, AgentTask, CliEnvironment } from "@viral/provider-core"
import { claudeEnv, makeClaudeCliProviderWith, runCost, type SessionTotals } from "./claude-cli-provider.ts"

// A stand-in `claude` that writes the variables a key setup touches to $FAKE_CLAUDE_LOG (test values only, "unset"
// when absent) and exits, so the test sees the child process's real environment.
const VARS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "MY_FLAG"]
let dir: string
let fake: string
before(() => {
  dir = mkdtempSync(join(tmpdir(), "viral-claude-cli-"))
  fake = join(dir, "claude")
  writeFileSync(fake, `#!/bin/sh
for v in ${VARS.join(" ")}; do
  eval "set=\\\${$v+x}; val=\\\${$v}"
  if [ -z "$set" ]; then echo "$v=unset"; else case "$val" in test-*|https://*|/*|"") echo "$v=$val";; *) echo "$v=(set)";; esac; fi
done > "$FAKE_CLAUDE_LOG"
exit 1
`)
  chmodSync(fake, 0o755)
})
after(() => rmSync(dir, { recursive: true, force: true }))

const Answer = Schema.Struct({ answer: Schema.Int })
const task: AgentTask<typeof Answer> = {
  stage: "test",
  instructions: "",
  skills: [],
  message: "go",
  output: { tool: "propose_answer", description: "the answer", schema: Answer },
  defaultModel: null
}
const hooks: AgentHooks = { progress: () => Effect.void, recordCost: () => Effect.void, recordSession: () => Effect.void }

const childEnv = async (name: string, cli?: CliEnvironment) => {
  const log = join(dir, `${name}.log`)
  process.env["FAKE_CLAUDE_LOG"] = log
  const exit = await Effect.runPromiseExit(
    makeClaudeCliProviderWith({ claudePath: fake }).pipe(
      Effect.flatMap((run) => run(task, hooks, null, "SYSTEM", cli)),
      Effect.provide(NodeServices.layer)
    )
  )
  assert.ok(Exit.isFailure(exit), "the fake never answers")
  return Object.fromEntries(readFileSync(log, "utf8").trim().split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)))
}

test("an OpenRouter setup reaches the claude process: token, empty API key, its own config folder", async () => {
  const env = await childEnv("router", {
    env: {
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: "test-openrouter-key-0042",
      ANTHROPIC_API_KEY: "",
      CLAUDE_CONFIG_DIR: "/tmp/viral-test/cli/claude-openrouter",
      MY_FLAG: "test-on"
    },
    apiKey: null
  })
  assert.deepEqual(env, {
    ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
    ANTHROPIC_AUTH_TOKEN: "test-openrouter-key-0042",
    ANTHROPIC_API_KEY: "",
    CLAUDE_CONFIG_DIR: "/tmp/viral-test/cli/claude-openrouter",
    MY_FLAG: "test-on"
  })
})

test("on your sign-in the process just inherits: no config folder or token of Viral's", async () => {
  const env = await childEnv("plain")
  assert.equal(env["ANTHROPIC_AUTH_TOKEN"], process.env["ANTHROPIC_AUTH_TOKEN"] === undefined ? "unset" : "(set)")
  assert.equal(env["CLAUDE_CONFIG_DIR"], process.env["CLAUDE_CONFIG_DIR"] ?? "unset")
  assert.equal(env["MY_FLAG"], "unset")
})

test("a run's variables go over the server's, which are kept", () => {
  assert.equal(claudeEnv({ PATH: "/bin" }, {}), undefined)
  assert.deepEqual(claudeEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "x" }, { ANTHROPIC_API_KEY: "" }), { PATH: "/bin", ANTHROPIC_API_KEY: "" })
})

// The CLI restores a session's totals on resume: a run resumed on Haiku after Opus reports both models and both runs'
// dollars (seen with claude 2.1.280). The run records only its own.
const OPUS_THEN_HAIKU: SessionTotals = {
  costUsd: 0.42,
  models: { "claude-opus-4-5": { costUsd: 0.4, outputTokens: 4000 }, "claude-haiku-4-5": { costUsd: 0.02, outputTokens: 1000 } }
}

test("a fresh session's result is the run's own", () => {
  const fresh: SessionTotals = { costUsd: 0.4, models: { "claude-opus-4-5": { costUsd: 0.4, outputTokens: 4000 } } }
  assert.deepEqual(runCost({ totals: fresh, runModels: { "claude-opus-4-5": 4000 } }, false, undefined, null), {
    model: "claude-opus-4-5",
    costUsd: 0.4
  })
})

test("a resumed run on another model records that model and only the dollars it added", () => {
  const before: SessionTotals = { costUsd: 0.4, models: { "claude-opus-4-5": { costUsd: 0.4, outputTokens: 4000 } } }
  assert.deepEqual(runCost({ totals: OPUS_THEN_HAIKU, runModels: { "claude-haiku-4-5": 1000 } }, true, before, "haiku"), {
    model: "claude-haiku-4-5",
    costUsd: 0.02
  })
})

test("resumed after a restart (earlier totals unknown): each model's cost is split by this run's share of its output", () => {
  assert.deepEqual(runCost({ totals: OPUS_THEN_HAIKU, runModels: { "claude-haiku-4-5": 1000 } }, true, undefined, "haiku"), {
    model: "claude-haiku-4-5",
    costUsd: 0.02
  })
  // a run that wrote nothing still names the model it was asked to run on
  assert.equal(runCost({ totals: OPUS_THEN_HAIKU, runModels: {} }, true, undefined, "haiku").model, "haiku")
})
