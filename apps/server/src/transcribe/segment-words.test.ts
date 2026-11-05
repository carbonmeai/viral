import assert from "node:assert/strict"
import { test } from "node:test"
import { segmentWords } from "./segment-words.ts"

const w = (text: string, s: number, e: number) => ({ w: text, s, e })

test("splits at sentence ends and long pauses", () => {
  const segments = segmentWords([
    w("This", 0, 0.3), w("is", 0.3, 0.5), w("sponsored.", 0.5, 1.0),
    w("Over", 1.2, 1.5), w("the", 1.5, 1.6), w("years", 1.6, 2.0),
    w("candy", 3.5, 4.0)
  ])
  assert.deepEqual(segments.map((s) => s.text), ["This is sponsored.", "Over the years", "candy"])
  assert.deepEqual(segments.map((s) => [s.start, s.end]), [[0, 1.0], [1.2, 2.0], [3.5, 4.0]])
})

test("caps run-on speech at 30 words", () => {
  const words = Array.from({ length: 65 }, (_, i) => w(`word${i}`, i * 0.3, i * 0.3 + 0.25))
  assert.deepEqual(segmentWords(words).map((s) => s.words.length), [30, 30, 5])
})
