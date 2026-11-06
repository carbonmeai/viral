import assert from "node:assert/strict"
import { test } from "node:test"
import { barHeights, dayLabel, formatCount, formatUsd } from "./usage-values.ts"

test("usage numbers read the way people say them", () => {
  assert.equal(formatUsd(0), "$0")
  assert.equal(formatUsd(0.004), "<$0.01")
  assert.equal(formatUsd(2.1734), "$2.17")
  assert.equal(formatCount(278), "278")
  assert.equal(formatCount(12_400), "12.4k")
  assert.equal(dayLabel("2026-11-06"), "Nov 6")
})

test("the chart scales to the busiest day and draws nothing for an empty period", () => {
  assert.deepEqual(barHeights([0, 1, 2]), [0, 0.5, 1])
  assert.deepEqual(barHeights([0, 0]), [0, 0])
})
