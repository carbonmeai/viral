import type { Transcript } from "@viral/contracts"
import { Schema } from "effect"
import { segmentWords } from "./segment-words.ts"

// POST https://api.x.ai/v1/stt response (batch). Times are seconds.
export const GrokSttResponse = Schema.Struct({
  text: Schema.String,
  language: Schema.String,
  duration: Schema.Finite,
  words: Schema.Array(Schema.Struct({ text: Schema.String, start: Schema.Finite, end: Schema.Finite }))
})
export type GrokSttResponse = typeof GrokSttResponse.Type

const round3 = (n: number) => Math.round(n * 1000) / 1000

// Into the same transcript.json shape the Whisper script writes, so every consumer reads one format.
export const grokToTranscript = (response: GrokSttResponse, sourcePath: string): Transcript => ({
  source: sourcePath,
  language: response.language,
  provider: "grok",
  segments: segmentWords(
    response.words
      .filter((word) => word.text.trim() !== "")
      .map((word) => ({ w: word.text.trim(), s: round3(word.start), e: round3(word.end) }))
  )
})
