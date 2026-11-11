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

// ---- The narrated ranking's entries ----

const RANK_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
const OPENING_RANK = /^[\s"“'‘(]*(?:number|#)\s*(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i

// The rank a narrated line opens with: "Number five, a good Samaritan…" → 5, "Number 3." → 3; null when it doesn't open
// on "Number N".
export const openingRank = (text: string): number | null => {
  const m = OPENING_RANK.exec(text)
  if (m === null) return null
  const said = m[1]!.toLowerCase()
  const n = /^\d+$/.test(said) ? Number(said) : RANK_WORDS.indexOf(said)
  return n >= 1 ? n : null
}

// One entry of a narrated ranking: its rank and its beats [start, end) in the script, from the narrated line that opens
// on "Number N" up to the next entry (the last entry runs to the closing question, so #1's reveal is in it).
export interface CountdownEntry {
  readonly rank: number
  readonly start: number
  readonly end: number
}

// A narrated ranking's script as the countdown: the hook (beats before the first entry) and each entry in playing
// order. The countdown starts on the first played narrated line that opens on "Number <count>" (so a hook like "Number
// one had already given up." stays in the hook), or, when none does, on the first line that opens on any rank; after
// that, every played line opening on "Number N" starts an entry.
export const rankingEntries = (
  beats: ReadonlyArray<ScriptBeat>,
  count: number | null = null
): { readonly hookEnd: number; readonly entries: ReadonlyArray<CountdownEntry> } => {
  const rankAt = (i: number) => {
    const beat = beats[i]
    return beat?._tag === "Narration" && beat.skipped !== true ? openingRank(beat.text) : null
  }
  const indices = beats.map((_, i) => i)
  const first = indices.find((i) => count !== null && rankAt(i) === count) ?? indices.find((i) => rankAt(i) !== null)
  if (first === undefined) return { hookEnd: beats.length, entries: [] }
  const storyEnd = beats.findIndex((b) => b._tag === "Cta")
  const end = storyEnd < 0 ? beats.length : storyEnd
  const starts = indices.filter((i) => i >= first && i < end && rankAt(i) !== null)
  return {
    hookEnd: first,
    entries: starts.map((start, k) => ({ rank: rankAt(start)!, start, end: starts[k + 1] ?? end }))
  }
}
