import assert from "node:assert/strict"
import { test } from "node:test"
import { barHeights, billingLabel, dayLabel, estimateUsd, formatCount, formatExact, formatUsd, modelCostText, planMeter, planUnavailableText, providerLabel, ttsModelLabel } from "./usage-values.ts"

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

test("providers and billing get plain names", () => {
  assert.equal(providerLabel("ai-gateway"), "AI Gateway")
  assert.equal(providerLabel(null), "Before tracking")
  assert.equal(billingLabel("subscription"), "Plan value")
  assert.equal(billingLabel(null), "Not tracked")
})

test("the ElevenLabs plan reads as characters used and left, and a price only when it's known", () => {
  assert.equal(formatExact(41_250), "41,250")
  assert.deepEqual(planMeter(41_250, 100_000), { left: 58_750, fraction: 0.4125 })
  assert.deepEqual(planMeter(120, 100), { left: 0, fraction: 1 })
  assert.deepEqual(planMeter(0, 0), { left: 0, fraction: 0 })
  assert.equal(estimateUsd(10_000, 0.00022), 2.2)
  assert.equal(estimateUsd(10_000, null), null)
  assert.match(planUnavailableText("no-permission"), /User › Read/)
  assert.equal(ttsModelLabel("eleven_v4"), "Eleven v4")
  assert.equal(ttsModelLabel("eleven_multilingual_v2"), "Eleven Multilingual v2")
})

test("direct-key costs: an estimate is marked, a missing price is said, never $0", () => {
  assert.equal(modelCostText(2.5, "reported"), "$2.50")
  assert.equal(modelCostText(2.5, "estimate"), "~$2.50")
  assert.equal(modelCostText(0, "unknown"), "price unknown")
  assert.equal(modelCostText(1, "unknown"), "$1.00 + price unknown")
  assert.equal(providerLabel("openrouter"), "OpenRouter")
})
