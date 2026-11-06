import { Schema } from "effect"
import { ApproachName } from "./approaches.ts"

// A line from the video, exactly as spoken, with its source seconds.
export const StoryQuote = Schema.Struct({ text: Schema.String, start: Schema.Finite, end: Schema.Finite })
export type StoryQuote = typeof StoryQuote.Type

// The long video's story, beat by beat (goal → process → setback → fix → result → reaction).
export const StoryBeat = Schema.Struct({
  beat: Schema.Literals(["goal", "process", "setback", "fix", "result", "reaction"]),
  start: Schema.Finite,
  end: Schema.Finite,
  summary: Schema.String,
  // the strongest real lines in this beat
  quotes: Schema.Array(StoryQuote)
})
export type StoryBeat = typeof StoryBeat.Type

// The virality radar, each axis 0–10.
export const ViralityScores = Schema.Struct({
  openLoop: Schema.Int,
  completionCompulsion: Schema.Int,
  universalRelatability: Schema.Int,
  shareability: Schema.Int
})
export type ViralityScores = typeof ViralityScores.Type

// One way to make a short from this video.
export const Proposal = Schema.Struct({
  approach: ApproachName,
  // the short's working title
  title: Schema.String,
  // the opening line
  hook: Schema.String,
  // why this approach suits this video
  why: Schema.String,
  scores: ViralityScores
})
export type Proposal = typeof Proposal.Type

export const StoryMap = Schema.Struct({
  summary: Schema.String,
  beats: Schema.Array(StoryBeat),
  // three proposals, best first; each one you pick becomes its own short
  proposals: Schema.Array(Proposal)
})
export type StoryMap = typeof StoryMap.Type
