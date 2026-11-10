import assert from "node:assert/strict"
import { test } from "node:test"
import { researchTask } from "./research-task.ts"

const task = (idea: string) => researchTask({ research: { idea, videos: 5, length: "180" }, tools: [], replacing: null })

test("a ranking idea asks for the ranking's vetting: one subject, 1–6 minutes, big views, real interview lines", () => {
  const { brief, skills } = task("Top 5 animal rescue comebacks")
  assert.deepEqual(skills, ["finding-source-videos"])
  assert.match(brief, /reads as a ranking/)
  assert.match(brief, /1–6 minutes, over a million views/)
  assert.match(brief, /real interview lines in its captions/)
  assert.doesNotMatch(task("Heidi Klum through the years").brief, /reads as a ranking/)
})
