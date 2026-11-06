import assert from "node:assert/strict"
import { test } from "node:test"
import { metadataTask } from "../metadata/metadata-task.ts"
import { creatorBriefLine } from "./creator-brief.ts"

test("the brief line trims the brief and is empty without one", () => {
  assert.equal(creatorBriefLine("  focus on the friend  "), "The creator's brief for this short: focus on the friend")
  assert.equal(creatorBriefLine(null), "")
  assert.equal(creatorBriefLine(" "), "")
})

test("the metadata task puts the brief first", () => {
  const input = { title: "Candy", channel: "NileBlue", summary: null, approach: "claim-interleaved", durationS: 50, workingTitle: "W", lines: "NARRATOR: hi" }
  assert.ok(metadataTask({ ...input, creatorBrief: "Make it about the friend." }).brief.startsWith("The creator's brief for this short: Make it about the friend."))
  assert.doesNotMatch(metadataTask(input).brief, /creator's brief/)
})
