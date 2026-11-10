import type { Account } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { keyRowState } from "./accounts-values.ts"

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
