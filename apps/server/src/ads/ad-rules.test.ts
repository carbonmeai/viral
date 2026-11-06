import assert from "node:assert/strict"
import { test } from "node:test"
import { checkAds } from "./ad-rules.ts"

test("pads, merges overlapping ranges and keeps them inside the video", () => {
  const { value, problems } = checkAds({
    ranges: [
      { start: 2160, end: 2200, kind: "sponsor", evidence: "Brilliant" },
      { start: 0, end: 2.2, kind: "sponsor", evidence: "sponsored by Brilliant" },
      { start: 2199, end: 2296, kind: "end-screen", evidence: "outro" }
    ]
  }, 2296)
  assert.deepEqual(problems, [])
  assert.deepEqual(value.ranges.map((r) => [r.start, r.end, r.kind]), [[0, 2.7, "sponsor"], [2159.5, 2296, "sponsor"]])
})

test("reports ranges that make no sense", () => {
  const { problems } = checkAds({
    ranges: [{ start: 50, end: 40, kind: "ad", evidence: "?" }, { start: 3000, end: 3010, kind: "ad", evidence: "?" }]
  }, 2296)
  assert.equal(problems.length, 2)
})
