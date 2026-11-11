import { Schema } from "effect"

// An approach is *what a short says and in what order*: hook, how voices mix, story shape, language and
// ending. Its writing rules live in the matching `approach-<name>` skill; this descriptor is what the
// stages and renderer act on.
export const ApproachName = Schema.Literals(["question-recap", "claim-interleaved", "story-recap", "cut-down", "ranking", "narrated-ranking"])
export type ApproachName = typeof ApproachName.Type

export const ApproachDescriptor = Schema.Struct({
  hook: Schema.Literals(["question", "claim", "result-first", "quote", "title-list"]),
  voices: Schema.Literals(["narration-then-reactions", "interleaved", "creator-only", "clips-own-sound"]),
  shape: Schema.Literals(["single-arc", "multi-loop", "full-story", "countdown"]),
  language: Schema.Literals(["plain", "technical"]),
  ending: Schema.Literals(["reaction", "joke-button", "hard-payoff", "real-payoff"]),
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
  // the creator's best-performing short ("10 Levels of Spicy"): claim-interleaved over the whole story, 60–120 s, with
  // the real payoff as one long take
  "story-recap": {
    hook: "claim",
    voices: "interleaved",
    shape: "full-story",
    language: "plain",
    ending: "real-payoff",
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
  // the list ranking, kept for clips that explain themselves visually (decision 3 of the skill review: the narrated
// ranking below is the default). "Ranking Animal Comebacks": one entry per video (before → care → after), each clip's own sound, a numbered list
  // that fills in, #1 last
  ranking: {
    hook: "title-list",
    voices: "clips-own-sound",
    shape: "countdown",
    language: "plain",
    ending: "hard-payoff",
    format: "ranking"
  },
  // the creator's approved "Top 5 Animal Comebacks": a narrator counts down one entry per video ("Number five, …"), each a
  // 20–25 s mini-story (before → care → reveal) with 1–2 real lines cut in, #1's reveal as the real ending. A narrated
  // short across several videos, so it runs the narrated pipeline (script → voice → shots → assemble → render)
  "narrated-ranking": {
    hook: "claim",
    voices: "interleaved",
    shape: "countdown",
    language: "plain",
    ending: "real-payoff",
    format: "narrated"
  }
}

// The two ways to make a ranking: the narrated countdown (the default) and the list of clips with their own sound. Both
// have an entry for every video of the short, so both need at least two.
export const RANKING_APPROACHES: ReadonlyArray<ApproachName> = ["narrated-ranking", "ranking"]
export const isRankingApproach = (approach: ApproachName) => RANKING_APPROACHES.includes(approach)

// The approaches a short from one video can take: a ranking needs an entry per video, so it's for several.
export const SINGLE_VIDEO_APPROACHES: ReadonlyArray<ApproachName> = ["question-recap", "claim-interleaved", "story-recap", "cut-down"]
