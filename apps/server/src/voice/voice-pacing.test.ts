import assert from "node:assert/strict"
import { test } from "node:test"
import { atempoFor, pace } from "./voice-pacing.ts"

const words = (n: number, span: number) => Array.from({ length: n }, (_, i) => ({ w: "word", s: (i * span) / n, e: ((i + 1) * span) / n }))

test("pace counts words over the spoken span", () => {
  assert.equal(pace(words(26, 10)), 2.6)
  assert.equal(pace([]), 0)
})

test("atempo reaches the target pace within the natural range", () => {
  assert.equal(atempoFor(2.56, 3.2), 1.25)
  assert.equal(atempoFor(1.5, 3.2), 1.5, "clamped when the take is far too slow")
  assert.equal(atempoFor(5, 3.2), 0.8, "clamped when it's far too fast")
  assert.equal(atempoFor(0, 3.2), 1)
})
