import { Schema } from "effect"

// An approach is *what a short says and in what order*: hook, how voices mix, story shape, language and
// ending. Its writing rules live in the matching `approach-<name>` skill; this descriptor is what the
// stages and renderer act on.
export const ApproachName = Schema.Literals(["question-recap", "claim-interleaved", "cut-down", "ranking"])
export type ApproachName = typeof ApproachName.Type

export const ApproachDescriptor = Schema.Struct({
  hook: Schema.Literals(["question", "claim", "result-first", "quote", "title-list"]),
  voices: Schema.Literals(["narration-then-reactions", "interleaved", "creator-only", "clips-own-sound"]),
  shape: Schema.Literals(["single-arc", "multi-loop", "countdown"]),
  language: Schema.Literals(["plain", "technical"]),
  ending: Schema.Literals(["reaction", "joke-button", "hard-payoff"]),
  // which renderer: a new voiceover over b-roll, the creator's own speech, or a ranked list of clips
  format: Schema.Literals(["narrated", "cut-down", "ranking"])
})
export type ApproachDescriptor = typeof ApproachDescriptor.Type

export const APPROACHES: Record<ApproachName, ApproachDescriptor> = {
  // the first candy short: "What would happen if…?", continuous narration, reactions at the end
  "question-recap": {
    hook: "question",
    voices: "narration-then-reactions",
    shape: "single-arc",
    language: "technical",
    ending: "reaction",
    format: "narrated"
  },
  // the competitor's candy short: a claim hook, real reactions cut into the narration, several small
  // setback → comeback loops, plain words, a joke-button ending
  "claim-interleaved": {
    hook: "claim",
    voices: "interleaved",
    shape: "multi-loop",
    language: "plain",
    ending: "joke-button",
    format: "narrated"
  },
  // the creator's own speech, spliced by story beat
  "cut-down": {
    hook: "quote",
    voices: "creator-only",
    shape: "single-arc",
    language: "plain",
    ending: "hard-payoff",
    format: "cut-down"
  },
  // "Ranking Animal Comebacks": one entry per video (before → care → after), each clip's own sound, a numbered list
  // that fills in, #1 last
  ranking: {
    hook: "title-list",
    voices: "clips-own-sound",
    shape: "countdown",
    language: "plain",
    ending: "hard-payoff",
    format: "ranking"
  }
}

// The approaches a short from one video can take: a ranking needs an entry per video, so it's for several.
export const SINGLE_VIDEO_APPROACHES: ReadonlyArray<ApproachName> = ["question-recap", "claim-interleaved", "cut-down"]
