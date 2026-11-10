import assert from "node:assert/strict"
import { test } from "node:test"
import { describeMetadataChange } from "./metadata-changes.ts"

const meta = { title: "One candy, every taste", alternates: ["A", "B"], description: "He made it.", hashtags: ["#shorts", "#candy", "#food"] }

test("a new title and hashtags added and removed", () => {
  const change = describeMetadataChange(meta, { ...meta, title: "The candy that hurts", hashtags: ["#shorts", "#candy", "#science"] })!
  assert.deepEqual(change.lines.map((l) => [l.label, l.old, l.new]), [["Title", "One candy, every taste", "The candy that hurts"], ["Hashtags", "#food", "#science"]])
  assert.equal(describeMetadataChange(meta, meta), null)
})
