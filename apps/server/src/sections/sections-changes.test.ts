import type { CutPlan } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { describeSectionsChange } from "./sections-changes.ts"

const section = (beat: CutPlan["sections"][number]["beat"], start: number, end: number, source = 0) =>
  ({ beat, start, end, source, note: "", text: `words at ${start}`, frame: null })
const plan: CutPlan = { hookText: "She fit inside her hand", sections: [section("hook", 21, 24, 1), section("rising_action", 100, 110), section("payoff", 200, 205)], storyboard: null }
const names = (i: number) => ["Candy", "Heidi"][i]!

test("a trimmed section, a removed one and the length are shown", () => {
  const next = { ...plan, sections: [plan.sections[0]!, section("rising_action", 100, 106)] }
  const change = describeSectionsChange(plan, next, names)!
  assert.equal(change.headline, "Changed section, removed 1")
  assert.match(change.lines[0]!.new ?? "", /Candy 1:40–1:46/)
  assert.equal(change.lines.find((l) => l.label === "Removed")?.old?.startsWith("Payoff · Candy 3:20"), true)
  assert.equal(change.lines.at(-1)!.note, "18.0s → 9.0s")
  assert.equal(describeSectionsChange(plan, plan, names), null)
})
