import assert from "node:assert/strict"
import { test } from "node:test"
import { filterSections } from "./sections.ts"

test("the search finds sections by name or by what's in them, keeping their groups", () => {
  assert.deepEqual(filterSections("").map((g) => [g.group, g.sections.length]), [["Personal", 4], ["App", 3]])
  assert.deepEqual(filterSections("grok").flatMap((g) => g.sections.map((s) => s.id)), ["accounts", "transcription"])
  assert.deepEqual(filterSections("COST").flatMap((g) => g.sections.map((s) => s.id)), ["usage"])
  assert.deepEqual(filterSections("nothing like this"), [])
})
