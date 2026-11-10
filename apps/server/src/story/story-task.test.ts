import assert from "node:assert/strict"
import { test } from "node:test"
import { storyTask } from "./story-task.ts"

test("the story stage leads with the format that suits the kind of video, and says why", () => {
  const task = storyTask({ title: "Candy", channel: null, excluded: [], sheets: [], sheetsDir: null, transcript: "[0.0–1.0] hi" })
  assert.match(task.instructions, /the one whose format suits this kind of video first/)
  assert.match(task.instructions, /first proposal's `why` starts with the kind of\s+video/)
  assert.match(task.instructions, /Cover every stage/)
  assert.ok(task.skills.includes("story-arc"), "the format table lives in story-arc")
})
