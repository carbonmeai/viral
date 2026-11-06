import assert from "node:assert/strict"
import { test } from "node:test"
import { ago, clock, plural } from "./format.ts"

test("clock, ago and plural read like the mockup", () => {
  assert.equal(clock(2296), "38:16")
  assert.equal(clock(3852), "1:04:12")
  assert.equal(clock(5), "0:05")
  const now = 10 * 86_400_000
  assert.equal(ago(now - 20_000, now), "just now")
  assert.equal(ago(now - 2 * 60_000, now), "2 min ago")
  assert.equal(ago(now - 3 * 3_600_000, now), "3 h ago")
  assert.equal(ago(now - 30 * 3_600_000, now), "yesterday")
  assert.equal(plural(1, "short"), "1 short")
  assert.equal(plural(3, "short"), "3 shorts")
})
