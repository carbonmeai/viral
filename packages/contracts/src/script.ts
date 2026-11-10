import { Schema } from "effect"
import { SourceIndex, VideoNumber } from "./sources.ts"

// One beat of a narrated short: a line the narrator says, or a real line from the long video played in its
// own audio. Real lines carry exact source seconds, checked against their video's transcript.
// A narrated line can be `skipped`: it's voiced in the take, but the short jumps over it because the real line just
// before it says the same thing (the renderer's `resume_word`). Writing it keeps the narrator's delivery natural around
// the cut, and the creator can let the narrator say it after all without a new take. Absent = played.
const Narration = Schema.TaggedStruct("Narration", { text: Schema.String, skipped: Schema.optionalKey(Schema.Boolean) })

// The closing question (a style's "End with a comment question"): the narrator's last line, after the payoff, asking
// viewers one question for the comments and to subscribe. Its own beat type, always last, outside the approach's word
// and real-line budgets. The agent writes only the question; the narrator says it with CLOSING_ASK after it, and the
// end card shows it over a held last frame.
const Cta = Schema.TaggedStruct("Cta", { question: Schema.String })
export const CLOSING_ASK = "Tell us in the comments, and subscribe for more."
// What the narrator says for a closing question.
export const closingLine = (question: string) => `${question.trim()} ${CLOSING_ASK}`

export const ScriptBeat = Schema.Union([
  Narration,
  Cta,
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

// The script's closing question, when it ends with one.
export const closingOf = (script: Script): string | null => {
  const last = script.beats.at(-1)
  return last?._tag === "Cta" ? last.question : null
}

// What the script agent sends: the same beats, with a real line's video numbered as the agent reads it (V2 = 2;
// absent = V1). The server checks it and stores a Script, whose `source` is the position (V2 = 1).
export const ProposedScriptBeat = Schema.Union([
  Narration,
  Cta,
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
