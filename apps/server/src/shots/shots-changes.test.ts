import type { ShotPlan } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { describeShotsChange } from "./shots-changes.ts"

const shot = (word: number, src: number, source = 0) => ({ word, src, source, note: "", wordText: `w${word}`, frame: null })
const plan: ShotPlan = { shots: [shot(0, 30), shot(4, 60), shot(9, 90)], markers: [], highlights: [], inserts: [], outro: [], storyboard: null }
const names = (i: number) => ["Candy", "Heidi"][i]!

test("one shot moved to another video reads as that shot, and the per-video count follows", () => {
  const next = { ...plan, shots: [plan.shots[0]!, plan.shots[1]!, shot(9, 41, 1)] }
  const change = describeShotsChange(plan, next, names)!
  assert.equal(change.headline, "Shot 3 now Heidi 0:41")
  assert.equal(change.lines[0]!.old, "Candy 1:30")
  assert.equal(change.lines.at(-1)!.note, "Candy 3 → Candy 2 · Heidi 1")
  assert.equal(describeShotsChange(plan, plan, names), null)
})
