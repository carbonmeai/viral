import { Transcript } from "@viral/contracts"
import { Schema } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { GrokSttResponse, grokToTranscript } from "./grok-response.ts"

// The response example from docs.x.ai (speech-to-text, batch).
const DOCS_EXAMPLE = {
  text: "The balance is $167,983.15.",
  language: "en",
  duration: 3.45,
  words: [
    { text: "The", start: 0.24, end: 0.48 },
    { text: "balance", start: 0.48, end: 0.96 },
    { text: "is", start: 0.96, end: 1.12 },
    { text: "$167,983.15.", start: 1.12, end: 3.2 }
  ]
}

test("converts the documented Grok response into a valid transcript", () => {
  const response = Schema.decodeSync(GrokSttResponse)(DOCS_EXAMPLE)
  const transcript = Schema.decodeSync(Transcript, { onExcessProperty: "error" })(
    grokToTranscript(response, "/videos/source.mp4")
  )
  assert.equal(transcript.provider, "grok")
  assert.equal(transcript.segments.length, 1)
  assert.deepEqual(transcript.segments[0]!.words.map((w) => w.w), ["The", "balance", "is", "$167,983.15."])
  assert.deepEqual(transcript.segments[0]!.words[3], { w: "$167,983.15.", s: 1.12, e: 3.2 })
})
