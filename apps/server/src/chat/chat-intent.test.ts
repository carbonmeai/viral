import assert from "node:assert/strict"
import { test } from "node:test"
import { intentMessage } from "./chat-intent.ts"

test("the intent agent sees the step, your words, and only the ids it may use", () => {
  const message = intentMessage({
    step: "music",
    text: "drop on worked instead",
    format: "narrated",
    voices: [{ id: "v1", name: "Adam", current: true }],
    songs: [{ id: "t1", title: "Viral drop song", fittable: true, current: true }, { id: "t2", title: "Raw", fittable: false, current: false }],
    words: ["But", "it", "worked"],
    dropWord: 0,
    styles: [{ id: "p1", name: "Viral recap", current: true }]
  })
  assert.match(message, /Step: music\. The short is narrated\./)
  assert.match(message, /Message: drop on worked instead/)
  assert.match(message, /Adam \[v1\] \(current\)/)
  assert.match(message, /Raw \[t2\] \(not fittable/)
  assert.match(message, /0:But 1:it 2:worked/)
  assert.match(message, /The drop lands on word 0\./)
  assert.match(message, /"shots" \(which footage plays/)
})
