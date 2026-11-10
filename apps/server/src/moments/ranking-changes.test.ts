import type { RankingPlan } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { describeRankingChange, rankingChecks } from "./ranking-changes.ts"

const shot = (role: "before" | "care" | "after", start: number) =>
  ({ role, start, end: start + 3, framing: "window", note: "", text: "", firstFrame: null, lastFrame: null }) as const
const entry = (rank: number, source: number, label: string) =>
  ({ rank, source, label, emoji: "🐱", shots: [shot("before", 10 * source + 1), shot("care", 10 * source + 5), shot("after", 10 * source + 9)] })
const plan: RankingPlan = {
  title: { lead: "Ranking ", accent: "Rescue Comebacks" },
  entries: [entry(1, 0, "Kai loses 100 pounds"), entry(2, 1, "Skin and bones to silly"), entry(3, 2, "Hissing cat melts")],
  order: [3, 2, 1]
} as unknown as RankingPlan

test("a swap of two ranks reads as one swap, with the length unchanged", () => {
  const swapped = { ...plan, entries: [plan.entries[0]!, { ...plan.entries[1]!, rank: 3 }, { ...plan.entries[2]!, rank: 2 }] }
  const change = describeRankingChange(plan, swapped)!
  assert.equal(change.headline, "Swapped #2 and #3")
  assert.equal(change.lines[0]!.old, "#2 Skin and bones to silly · #3 Hissing cat melts")
  assert.equal(change.lines[0]!.new, "#2 Hissing cat melts · #3 Skin and bones to silly")
  assert.equal(change.lines.at(-1)!.note, "Still 27.0s")
})

test("a new title and a moved moment are listed; nothing changed is no card", () => {
  const next = { ...plan, entries: [{ ...plan.entries[0]!, label: "Kai's big comeback" }, plan.entries[1]!, plan.entries[2]!] }
  const change = describeRankingChange(plan, next)!
  assert.ok(change.lines.some((l) => l.label === "#1 title" && l.new === "Kai's big comeback 🐱"))
  assert.equal(describeRankingChange(plan, plan), null)
  assert.ok(rankingChecks(plan).some((c) => c.text === "27.0s in all, under the length limit"))
})
