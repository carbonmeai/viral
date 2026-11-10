// Live check against your Claude CLI (Haiku, about a cent): one helper tool call, the output tool, cost and the
// session. Skipped when the CLI isn't installed or signed in. Run with `bun run test:live`.
import { NodeServices } from "@effect/platform-node"
import { runLiveTask, SECRET } from "@viral/provider-testing"
import { Effect, Schema } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { makeClaudeCliProvider } from "./claude-cli-provider.ts"

const AuthStatus = Schema.fromJsonString(Schema.Struct({ loggedIn: Schema.Boolean }))

const skip = (() => {
  try {
    const status = Schema.decodeSync(AuthStatus)(execFileSync("claude", ["auth", "status"], { encoding: "utf8" }))
    return status.loggedIn ? false : "the Claude CLI isn't signed in: run `claude auth login`"
  } catch {
    return "the Claude CLI isn't installed (or `claude auth status` failed)"
  }
})()

test("the Claude CLI runs a helper tool, submits the result and reports its cost", { skip, timeout: 180_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "viral-live-claude-"))
  const cwd = process.cwd()
  process.chdir(scratch)
  try {
    const run = await Effect.runPromise(runLiveTask(makeClaudeCliProvider, "haiku").pipe(Effect.provide(NodeServices.layer)))
    console.log(JSON.stringify({ seconds: run.seconds, costs: run.costs }))
    assert.deepEqual(run.result, { answer: SECRET + 5 })
    assert.ok(run.progress.includes("→ secret_number"), "the helper tool reached the model")
    assert.equal(run.sessions.length, 1)
    assert.equal(run.costs.length, 1)
    assert.match(run.costs[0]!.model ?? "", /haiku/)
    assert.ok(run.costs[0]!.inputTokens > 0 && run.costs[0]!.outputTokens > 0)
    assert.ok((run.costs[0]!.costUsd ?? 0) > 0, "the CLI reports a dollar cost")
  } finally {
    process.chdir(cwd)
    rmSync(scratch, { recursive: true, force: true })
  }
})
