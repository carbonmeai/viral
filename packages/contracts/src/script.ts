import { Schema } from "effect"
import { SourceIndex, VideoNumber } from "./sources.ts"

// One beat of a narrated short: a line the narrator says, or a real line from the long video played in its
// own audio. Real lines carry exact source seconds, checked against their video's transcript.
export const ScriptBeat = Schema.Union([
  Schema.TaggedStruct("Narration", { text: Schema.String }),
  Schema.TaggedStruct("Real", {
    // the words exactly as spoken in the video
    quote: Schema.String,
    start: Schema.Finite,
    end: Schema.Finite,
    // which of the short's videos it's from (V1 = 0); leave it out when the short has one video
    source: Schema.optionalKey(SourceIndex)
  })
])
export type ScriptBeat = typeof ScriptBeat.Type

export const Script = Schema.Struct({
  // the pinned headline: the open loop in 7 words or fewer, split over two lines
  headline: Schema.NullOr(Schema.Tuple([Schema.String, Schema.String])),
  beats: Schema.Array(ScriptBeat)
})
export type Script = typeof Script.Type

// What the script agent sends: the same beats, with a real line's video numbered as the agent reads it (V2 = 2;
// absent = V1). The server checks it and stores a Script, whose `source` is the position (V2 = 1).
export const ProposedScriptBeat = Schema.Union([
  Schema.TaggedStruct("Narration", { text: Schema.String }),
  Schema.TaggedStruct("Real", {
    quote: Schema.String,
    start: Schema.Finite,
    end: Schema.Finite,
    // which video it's from, by its V number; leave it out when the short has one video
    video: Schema.optionalKey(VideoNumber)
  })
])
export const ProposedScript = Schema.Struct({ headline: Script.fields.headline, beats: Schema.Array(ProposedScriptBeat) })
export type ProposedScript = typeof ProposedScript.Type
