import assert from "node:assert/strict"
import { test } from "node:test"
import { peaksOf, wordIndexAt } from "./voice-values.ts"

test("peaks are each slice's loudest sample, scaled to the loudest", () => {
  const samples = new Float32Array([0.1, -0.2, 0.5, -1, 0, 0.25, 0, 0])
  assert.deepEqual(peaksOf(samples, 4).map((v) => Math.round(v * 100) / 100), [0.2, 1, 0.25, 0])
  assert.deepEqual(peaksOf(new Float32Array(), 4), [])
})

test("the spoken word is the last one started", () => {
  const words = [{ w: "a", s: 0, e: 0.3 }, { w: "b", s: 0.5, e: 0.8 }]
  assert.equal(wordIndexAt(words, -0.1), -1)
  assert.equal(wordIndexAt(words, 0.4), 0)
  assert.equal(wordIndexAt(words, 0.6), 1)
})
