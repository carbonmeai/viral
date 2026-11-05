import { Schema } from "effect"

// Mirrors transcript.json written by the transcribe script: word timings in seconds.
export const TranscriptWord = Schema.Struct({
  w: Schema.String,
  s: Schema.Finite,
  e: Schema.Finite
})
export type TranscriptWord = typeof TranscriptWord.Type

export const TranscriptSegment = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String,
  words: Schema.Array(TranscriptWord)
})
export type TranscriptSegment = typeof TranscriptSegment.Type

export const Transcript = Schema.Struct({
  source: Schema.String,
  language: Schema.String,
  segments: Schema.Array(TranscriptSegment)
})
export type Transcript = typeof Transcript.Type
