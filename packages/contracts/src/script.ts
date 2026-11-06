import { Schema } from "effect"

// One beat of a narrated short: a line the narrator says, or a real line from the long video played in its
// own audio. Real lines carry exact source seconds, checked against the transcript.
export const ScriptBeat = Schema.Union([
  Schema.TaggedStruct("Narration", { text: Schema.String }),
  Schema.TaggedStruct("Real", {
    // the words exactly as spoken in the video
    quote: Schema.String,
    start: Schema.Finite,
    end: Schema.Finite
  })
])
export type ScriptBeat = typeof ScriptBeat.Type

export const Script = Schema.Struct({
  // the pinned headline: the open loop in 7 words or fewer, split over two lines
  headline: Schema.NullOr(Schema.Tuple([Schema.String, Schema.String])),
  beats: Schema.Array(ScriptBeat)
})
export type Script = typeof Script.Type
