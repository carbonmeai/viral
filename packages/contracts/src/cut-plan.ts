import { Schema } from "effect"

// The story beat a section of a cut-down short plays (story-arc skill).
export const CutBeat = Schema.Literals(["hook", "rising_action", "conflict", "comeback", "payoff"])
export type CutBeat = typeof CutBeat.Type

// One stretch of the creator's own speech, in source seconds. Sections play in the order given.
export const CutSection = Schema.Struct({
  beat: CutBeat,
  start: Schema.Finite,
  end: Schema.Finite,
  // horizontal centre of the crop, 0–1, when the speaker sits off-centre
  cropX: Schema.optionalKey(Schema.Finite),
  // crop: the footage fills 9:16 · blur: the whole frame over a blurred fill (screen shares, wide shots)
  framing: Schema.optionalKey(Schema.Literals(["crop", "blur"])),
  // what this section says or shows, and why it's here
  note: Schema.String
})
export type CutSection = typeof CutSection.Type

// What the sections agent proposes for a cut-down short.
export const SectionsProposal = Schema.Struct({
  // the open loop over the hook, readable with the sound off; null for none
  hookText: Schema.NullOr(Schema.String),
  sections: Schema.Array(CutSection)
})
export type SectionsProposal = typeof SectionsProposal.Type

// The approved cut plan: sections snapped to word boundaries, each with the words it says and its own frame
// (a jpg next to the plan, e.g. "frames/section-01.jpg"; null when the frames couldn't be drawn).
export const CutPlan = Schema.Struct({
  hookText: Schema.NullOr(Schema.String),
  sections: Schema.Array(Schema.Struct({
    ...CutSection.fields,
    text: Schema.String,
    frame: Schema.NullOr(Schema.String)
  })),
  // the frames stitched into one image in playing order
  storyboard: Schema.NullOr(Schema.String)
})
export type CutPlan = typeof CutPlan.Type

// Mirrors the plan render-short.py reads (snake_case: it's the Python renderer's file format).
export const CutRenderPlan = Schema.Struct({
  slug: Schema.String,
  title: Schema.optionalKey(Schema.String),
  source: Schema.String,
  transcript: Schema.String,
  framing: Schema.Literals(["crop", "blur"]),
  crop_x: Schema.optionalKey(Schema.Finite),
  captions: Schema.optionalKey(Schema.Boolean),
  caption_y: Schema.optionalKey(Schema.Finite),
  caption_highlight: Schema.optionalKey(Schema.String),
  caption_case: Schema.optionalKey(Schema.Literals(["lower", "upper", "as-spoken"])),
  // a title card over the hook
  hook_text: Schema.optionalKey(Schema.String),
  hook_text_seconds: Schema.optionalKey(Schema.Finite),
  // e.g. "Video: NileBlue", small and steady in a corner
  credit: Schema.optionalKey(Schema.String),
  // sponsor/ad/end-screen source ranges; the renderer fails if a section touches one
  exclude: Schema.optionalKey(Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite]))),
  // false when the sections are already snapped to words (the server's plans); absent or true, the renderer
  // snaps them outward itself, as the skill's plans expect
  snap: Schema.optionalKey(Schema.Boolean),
  sections: Schema.Array(Schema.Struct({
    beat: CutBeat,
    start: Schema.Finite,
    end: Schema.Finite,
    crop_x: Schema.optionalKey(Schema.Finite),
    framing: Schema.optionalKey(Schema.Literals(["crop", "blur"]))
  })),
  lufs: Schema.optionalKey(Schema.Finite)
})
export type CutRenderPlan = typeof CutRenderPlan.Type
