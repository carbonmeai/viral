import { Schema } from "effect"

// What the shots agent proposes: b-roll anchored to voiceover words, and a few markers. Word indexes point
// into the voiceover transcript's words, counted from 0.
export const PlannedShot = Schema.Struct({
  // the voiceover word the shot starts on
  word: Schema.Int,
  // source seconds where the shot's footage starts
  src: Schema.Finite,
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

export const ShotProposal = Schema.Struct({
  shots: Schema.Array(PlannedShot),
  markers: Schema.Array(Marker)
})
export type ShotProposal = typeof ShotProposal.Type

// A real-voice clip from the script: an insert plays after voiceover word `afterWord`; an outro clip plays
// after the narration ends.
export const RealClip = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  quote: Schema.String
})
export const ShotInsert = Schema.Struct({ ...RealClip.fields, afterWord: Schema.Int, afterWordText: Schema.String })
export type ShotInsert = typeof ShotInsert.Type

// The approved shot plan: the proposal with each anchor's word text, and the inserts and outro the server
// placed from the script. Assemble turns it into the renderer's narrated plan.
export const ShotPlan = Schema.Struct({
  shots: Schema.Array(Schema.Struct({ ...PlannedShot.fields, wordText: Schema.String })),
  markers: Schema.Array(Marker),
  inserts: Schema.Array(ShotInsert),
  outro: Schema.Array(RealClip),
  // the storyboard image next to the plan: one frame per shot, then the real clips
  storyboard: Schema.NullOr(Schema.String)
})
export type ShotPlan = typeof ShotPlan.Type
