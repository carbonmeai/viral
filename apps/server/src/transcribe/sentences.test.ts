import assert from "node:assert/strict"
import { test } from "node:test"
import { wholeSentencesOf } from "./sentences.ts"

// words spoken one after another, 0.4 s each with 0.1 s between, from `at`
const say = (at: number, text: string) => text.split(" ").map((w, i) => ({ w, s: at + i * 0.5, e: at + i * 0.5 + 0.4 }))

test("a quote widens to the whole sentences it starts and ends in", () => {
  const words = [...say(10, "The vet gave her fluids."), ...say(20, "She stood up and walked.")]
  // "gave her" (2–3) → "The vet gave her fluids." (0–4)
  assert.deepEqual(wholeSentencesOf(words, 2, 3), { first: 0, last: 4 })
  // "fluids. She stood" crosses into the second sentence, which it finishes
  assert.deepEqual(wholeSentencesOf(words, 4, 7), { first: 0, last: 9 })
  // already whole
  assert.deepEqual(wholeSentencesOf(words, 5, 9), { first: 5, last: 9 })
})

test("a pause over 1.5 s ends a sentence even without a full stop", () => {
  const words = [...say(10, "near death"), ...say(13, "to becoming the bravest dog.")]
  assert.deepEqual(wholeSentencesOf(words, 3, 4), { first: 2, last: 6 })
})

test("a transcript with no punctuation is no guide: the quote stays as it is", () => {
  const words = say(0, Array.from({ length: 80 }, (_, i) => `w${i}`).join(" "))
  assert.deepEqual(wholeSentencesOf(words, 30, 33), { first: 30, last: 33 })
})
