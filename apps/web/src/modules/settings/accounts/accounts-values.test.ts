import type { Account, CliSetup } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { cliSetupLines, envLines, envValueText, keyRowState, runsOnOptions } from "./accounts-values.ts"

const NOW = Date.parse("2026-11-10T12:00:00Z")
const base: Account = {
  name: "anthropic",
  status: "missing",
  source: null,
  detail: null,
  version: null,
  hint: null,
  envVar: null,
  last4: null,
  check: null
}
const works = { code: "ok", message: "Works. 63 models available.", models: 63, checkedAt: "2026-11-10T11:58:00Z" } as const

test("a key that isn't set can only be added", () => {
  const state = keyRowState(base, "about", true, NOW)
  assert.deepEqual(state.chip, { tone: "neutral", text: "Not set" })
  assert.deepEqual([state.canChange, state.canRemove, state.canTest], [true, false, false])
})

test("a saved key shows its last four characters; its good check only in Detailed", () => {
  const saved: Account = { ...base, status: "ready", source: "keychain", last4: "a1F9", check: works }
  const detailed = keyRowState(saved, "about", true, NOW)
  assert.deepEqual(detailed.chip, { tone: "ok", text: "Saved …a1F9" })
  assert.deepEqual(detailed.lines.map((l) => l.text), ["about", "Checked 2 min ago: Works. 63 models available."])
  assert.deepEqual([detailed.canChange, detailed.canRemove, detailed.canTest], [true, true, true])
  assert.deepEqual(keyRowState(saved, "about", false, NOW).lines.map((l) => l.text), ["about"])
})

test("a refused key says so in both modes", () => {
  const refused: Account = { ...base, status: "ready", source: "keychain", last4: "a1F9", check: { ...works, code: "refused", message: "Anthropic refused this key.", models: null } }
  const simple = keyRowState(refused, "about", false, NOW)
  assert.deepEqual(simple.chip, { tone: "wait", text: "Key refused" })
  assert.deepEqual(simple.lines.at(-1), { text: "Checked 2 min ago: Anthropic refused this key.", tone: "warn" })
})

test("an environment key names its variable and can be tested but not changed or removed", () => {
  const env: Account = { ...base, status: "ready", source: "environment", envVar: "ANTHROPIC_API_KEY", last4: "zz12" }
  const state = keyRowState(env, "about", false, NOW)
  assert.deepEqual(state.chip, { tone: "ok", text: "From ANTHROPIC_API_KEY" })
  assert.match(state.lines[1]?.text ?? "", /ANTHROPIC_API_KEY …zz12\)\. A key saved here is ignored/)
  assert.deepEqual([state.canChange, state.canRemove, state.canTest], [false, false, true])
})

const setup: CliSetup = {
  cli: "claude",
  preset: "claude-openrouter",
  presetVars: [{ name: "ANTHROPIC_AUTH_TOKEN", value: "your OpenRouter key …a1F9" }],
  env: [],
  configDir: "/Users/me/.viral/cli/claude-openrouter",
  billing: "billed",
  using: "Using your OpenRouter key",
  problem: null
}

test("a preset needs its key saved before it can be picked", () => {
  const options = runsOnOptions("claude", { ...setup, preset: null }, new Set(["anthropic"]))
  assert.deepEqual(options.map((o) => [o.value, "disabled" in o]), [["signin", false], ["claude-openrouter", true], ["claude-anthropic", false]])
  // the one in use stays pickable, so it can be seen
  assert.ok(!("disabled" in runsOnOptions("claude", setup, new Set()).find((o) => o.value === "claude-openrouter")!))
  assert.deepEqual(runsOnOptions("codex", undefined, new Set(["openai"])).map((o) => o.value), ["signin", "codex-openai"])
})

test("secrets show as dots and their last four; the preset's variables only in Detailed", () => {
  assert.equal(envValueText({ name: "T", value: null, secret: true, last4: "1234" }), "••••••1234")
  assert.equal(envValueText({ name: "T", value: "", secret: false, last4: null }), "(empty)")
  assert.deepEqual(cliSetupLines(setup, false).map((l) => l.text), ["Runs here count as billed in Usage (real money)."])
  assert.deepEqual(envLines(setup, false), [])
  assert.deepEqual(envLines({ ...setup, presetVars: [{ name: "CLAUDE_CONFIG_DIR", value: "/Users/me/.viral/cli/claude-openrouter" }] }, true), [
    { name: "CLAUDE_CONFIG_DIR", value: "~/.viral/cli/claude-openrouter", secret: false, fromSetup: true }
  ])
  assert.deepEqual(cliSetupLines({ ...setup, preset: null, presetVars: [], billing: "subscription" }, true), [])
})
