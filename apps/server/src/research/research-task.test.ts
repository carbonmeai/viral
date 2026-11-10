import assert from "node:assert/strict"
import { test } from "node:test"
import { narratedRankingSeconds, videosForIdea } from "@viral/contracts"
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

test("a ranking idea finds 5 videos unless it names another count, and the length is estimated as a narrated ranking", () => {
  assert.equal(videosForIdea("Top 5 animal rescue comebacks, before and after"), 5)
  assert.equal(videosForIdea("Top 7 bridge demolitions"), 7)
  assert.equal(videosForIdea("Top 4 fails"), 5, "not one of the choices: the default")
  assert.equal(videosForIdea("The best saves, ranked"), 5)
  assert.equal(narratedRankingSeconds(5), 132, "rescues5: 2:12")
  assert.match(task("Top 5 animal rescue comebacks").brief, /as a narrated ranking ≈ 2:12 \(about 20–25 s per entry/)
  assert.match(task("Top 5 animal rescue comebacks").brief, /a pick that breaks one comes back to you/)
})
