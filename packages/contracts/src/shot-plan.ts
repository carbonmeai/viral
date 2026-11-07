import { Schema } from "effect"
import { SourceIndex, VideoNumber } from "./sources.ts"

// What the shots agent proposes: b-roll anchored to voiceover words, and a few markers. Word indexes point
// into the voiceover transcript's words, counted from 0.
export const PlannedShot = Schema.Struct({
  // the voiceover word the shot starts on
  word: Schema.Int,
  // source seconds where the shot's footage starts
  src: Schema.Finite,
  // which of the short's videos it's from (V1 = 0); leave it out when the short has one video
  source: Schema.optionalKey(SourceIndex),
  // show the whole frame (on-screen graphics or text) instead of cropping it
  fit: Schema.optionalKey(Schema.Boolean),
  // horizontal centre of the crop, 0–1 (0.5 = centre), when the hero object sits off-centre
  cropX: Schema.optionalKey(Schema.Finite),
  // playback speed for slow processes or graphics that build up
  speed: Schema.optionalKey(Schema.Finite),
  // what the shot shows
  note: Schema.String
})
export type PlannedShot = typeof PlannedShot.Type

const MarkerAt = { word: Schema.Int, x: Schema.Finite, y: Schema.Finite }
export const Marker = Schema.Union([
  // one or two words naming what the viewer is looking at ("STICKY")
  Schema.TaggedStruct("Label", { ...MarkerAt, text: Schema.String }),
  // a circle or an arrow on the hero object; x, y are fractions of the frame
  Schema.TaggedStruct("Circle", MarkerAt),
  Schema.TaggedStruct("Arrow", MarkerAt)
])
export type Marker = typeof Marker.Type

// A caption colour picked for a word's meaning ("spicy" red, "cold" cyan); "accent" is the style's own highlight.
export const HighlightColor = Schema.Literals(["accent", "red", "orange", "yellow", "green", "cyan", "blue", "pink", "purple", "white"])
export type HighlightColor = typeof HighlightColor.Type

// A word to colour in the captions: just the word (the style's accent), or the word with a colour.
export const Highlight = Schema.Union([Schema.String, Schema.Struct({ word: Schema.String, color: HighlightColor })])
export type Highlight = typeof Highlight.Type

export const ShotProposal = Schema.Struct({
  shots: Schema.Array(PlannedShot),
  markers: Schema.Array(Marker),
  // 5–10 key words of the narration to colour in the captions ("sour", "spicy"), each with a colour that
  // fits its meaning
  highlights: Schema.optionalKey(Schema.Array(Highlight))
})
export type ShotProposal = typeof ShotProposal.Type

// What the shots agent sends: the same plan, with each shot's video numbered as the agent reads it (V2 = 2;
// absent = V1). The server checks it and keeps a ShotProposal, whose `source` is the position (V2 = 1).
const { word, src, fit, cropX, speed, note } = PlannedShot.fields
export const ProposedShot = Schema.Struct({
  word,
  src,
  fit,
  cropX,
  speed,
  note,
  // which video the footage is from, by its V number; leave it out when the short has one video
  video: Schema.optionalKey(VideoNumber)
})
export type ProposedShot = typeof ProposedShot.Type
export const ProposedShots = Schema.Struct({ ...ShotProposal.fields, shots: Schema.Array(ProposedShot) })
export type ProposedShots = typeof ProposedShots.Type

// A real-voice clip from the script: an insert plays after voiceover word `afterWord`; an outro clip plays
// after the narration ends.
export const RealClip = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  quote: Schema.String,
  // which of the short's videos it's from (V1 = 0); leave it out when the short has one video
  source: Schema.optionalKey(SourceIndex)
})
export const ShotInsert = Schema.Struct({ ...RealClip.fields, afterWord: Schema.Int, afterWordText: Schema.String })
export type ShotInsert = typeof ShotInsert.Type

// Each shot and real clip keeps its own frame (a jpg next to the plan, e.g. "frames/shot-01.jpg"), so a client
// can show it on its own and offer another; null when the frames couldn't be drawn.
const Frame = { frame: Schema.NullOr(Schema.String) }

// The approved shot plan: the proposal with each anchor's word text, and the inserts and outro the server
// placed from the script. Assemble turns it into the renderer's narrated plan.
export const ShotPlan = Schema.Struct({
  shots: Schema.Array(Schema.Struct({ ...PlannedShot.fields, wordText: Schema.String, ...Frame })),
  markers: Schema.Array(Marker),
  highlights: Schema.Array(Highlight),
  inserts: Schema.Array(Schema.Struct({ ...ShotInsert.fields, ...Frame })),
  outro: Schema.Array(Schema.Struct({ ...RealClip.fields, ...Frame })),
  // the storyboard: the frames above stitched into one image in playing order
  storyboard: Schema.NullOr(Schema.String)
})
export type ShotPlan = typeof ShotPlan.Type
