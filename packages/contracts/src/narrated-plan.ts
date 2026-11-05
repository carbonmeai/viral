import { Schema } from "effect"

// Mirrors narrated.json, the plan render-narrated.py reads. Keys stay snake_case because this is
// the file format the Python renderer consumes.

const Seconds = Schema.Finite
const Fraction = Schema.Finite
const SourceRange = Schema.Tuple([Seconds, Seconds])

// A timed item is anchored either at voiceover seconds (`at`) or to a voiceover word index (`word`);
// `word_text` guards the anchor, and the renderer fails if it no longer matches the word.
const WordAnchor = {
  at: Schema.optionalKey(Seconds),
  word: Schema.optionalKey(Schema.Int),
  word_text: Schema.optionalKey(Schema.String),
  offset: Schema.optionalKey(Seconds)
}

const Framing = {
  fit: Schema.optionalKey(Schema.Boolean),
  crop_x: Schema.optionalKey(Fraction),
  crop_y: Schema.optionalKey(Fraction),
  zoom: Schema.optionalKey(Schema.Finite)
}

export const NarratedShot = Schema.Struct({
  src: Seconds,
  ...WordAnchor,
  ...Framing,
  speed: Schema.optionalKey(Schema.Finite),
  note: Schema.optionalKey(Schema.String)
})
export type NarratedShot = typeof NarratedShot.Type

// A real-voice clip played *during* the narration: the voiceover pauses after word `after_word`, the clip
// plays with its own audio, then the voiceover resumes. Everything later shifts by the clip's length.
export const NarratedInsert = Schema.Struct({
  start: Seconds,
  end: Seconds,
  after_word: Schema.Int,
  after_word_text: Schema.optionalKey(Schema.String),
  ...Framing,
  captions: Schema.optionalKey(Schema.Boolean),
  note: Schema.optionalKey(Schema.String)
})
export type NarratedInsert = typeof NarratedInsert.Type

// The creator's real audio, appended after the narration.
export const NarratedOutro = Schema.Struct({
  start: Seconds,
  end: Seconds,
  ...Framing,
  captions: Schema.optionalKey(Schema.Boolean),
  note: Schema.optionalKey(Schema.String)
})
export type NarratedOutro = typeof NarratedOutro.Type

const AnnotationBase = {
  ...WordAnchor,
  dur: Schema.optionalKey(Seconds),
  x: Fraction,
  y: Fraction,
  color: Schema.optionalKey(Schema.String)
}

export const NarratedAnnotation = Schema.Union([
  // small spaced text, e.g. "STICKY", "VERSION 2"
  Schema.Struct({
    type: Schema.Literal("label"),
    ...AnnotationBase,
    text: Schema.String,
    size: Schema.optionalKey(Fraction)
  }),
  Schema.Struct({ type: Schema.Literal("circle"), ...AnnotationBase, r: Schema.optionalKey(Fraction) }),
  Schema.Struct({
    type: Schema.Literal("arrow"),
    ...AnnotationBase,
    from: Schema.optionalKey(Schema.Finite),
    len: Schema.optionalKey(Fraction)
  }),
  Schema.Struct({
    type: Schema.Literal("text"),
    ...AnnotationBase,
    text: Schema.String,
    size: Schema.optionalKey(Fraction)
  })
])
export type NarratedAnnotation = typeof NarratedAnnotation.Type

// Bar-aligned music bed: the build loops in whole bars so `drop` lands on `drop_word` (or `drop_at`).
export const MusicConfig = Schema.Struct({
  file: Schema.String,
  drop: Seconds,
  bpm: Schema.optionalKey(Schema.Finite),
  bar: Schema.optionalKey(Seconds),
  build_bars: Schema.optionalKey(Schema.Finite),
  groove_bars: Schema.optionalKey(Schema.Finite),
  drop_bars: Schema.optionalKey(Schema.Finite),
  drop_word: Schema.optionalKey(Schema.Int),
  drop_word_text: Schema.optionalKey(Schema.String),
  drop_offset: Schema.optionalKey(Seconds),
  drop_at: Schema.optionalKey(Seconds),
  drop_gain: Schema.optionalKey(Schema.Finite),
  note: Schema.optionalKey(Schema.String)
})
export type MusicConfig = typeof MusicConfig.Type

// A sound effect laid over the short. Anchored like shots (`at` or a voiceover `word`); the sound stage
// resolves shot and drop anchors into these before rendering. `file` is absolute or relative to the plan.
export const SfxCue = Schema.Struct({
  file: Schema.String,
  ...WordAnchor,
  gain: Schema.optionalKey(Schema.Finite),
  note: Schema.optionalKey(Schema.String)
})
export type SfxCue = typeof SfxCue.Type

export const NarratedPlan = Schema.Struct({
  slug: Schema.String,
  title: Schema.optionalKey(Schema.String),
  source: Schema.String,
  source_transcript: Schema.optionalKey(Schema.String),
  voiceover: Schema.String,
  voiceover_transcript: Schema.String,
  canvas: Schema.optionalKey(Schema.Tuple([Schema.Int, Schema.Int])),
  main_height: Schema.optionalKey(Schema.Int),
  caption_y: Schema.optionalKey(Fraction),
  captions: Schema.optionalKey(Schema.Boolean),
  lowercase: Schema.optionalKey(Schema.Boolean),
  // absent = one word at a time (the original format)
  caption_mode: Schema.optionalKey(Schema.Literals(["word", "chunk"])),
  caption_max_words: Schema.optionalKey(Schema.Int),
  caption_case: Schema.optionalKey(Schema.Literals(["lower", "upper", "as-spoken"])),
  caption_highlight: Schema.optionalKey(Schema.String),
  // insert and outro speech in a quote box
  quote_box: Schema.optionalKey(Schema.Boolean),
  // absent = band (the original layout)
  framing: Schema.optionalKey(Schema.Literals(["band", "full"])),
  // pinned for the whole short, or until `until` seconds
  headline: Schema.optionalKey(Schema.Struct({
    lines: Schema.Array(Schema.Struct({ text: Schema.String, color: Schema.optionalKey(Schema.String) })),
    y: Schema.optionalKey(Fraction),
    size: Schema.optionalKey(Fraction),
    until: Schema.optionalKey(Seconds)
  })),
  // e.g. "Video: NileBlue"
  credit: Schema.optionalKey(Schema.String),
  // word (lowercase, punctuation stripped) -> caption color
  highlights: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  // sponsor/ad/end-screen source ranges; the renderer fails if a shot touches one
  exclude: Schema.optionalKey(Schema.Array(SourceRange)),
  exclude_note: Schema.optionalKey(Schema.String),
  narration_end: Schema.optionalKey(Seconds),
  shots: Schema.Array(NarratedShot),
  inserts: Schema.optionalKey(Schema.Array(NarratedInsert)),
  outro: Schema.optionalKey(Schema.Array(NarratedOutro)),
  annotations: Schema.optionalKey(Schema.Array(NarratedAnnotation)),
  // absent = no sound effects, and the render is exactly as before
  sfx: Schema.optionalKey(Schema.Array(SfxCue)),
  sfx_gain: Schema.optionalKey(Schema.Finite),
  music: Schema.optionalKey(Schema.Union([Schema.String, MusicConfig])),
  music_gain: Schema.optionalKey(Schema.Finite),
  music_start: Schema.optionalKey(Seconds),
  duck_ratio: Schema.optionalKey(Schema.Finite),
  duck_threshold: Schema.optionalKey(Schema.Finite),
  voice_gain: Schema.optionalKey(Schema.Finite),
  lufs: Schema.optionalKey(Schema.Finite)
})
export type NarratedPlan = typeof NarratedPlan.Type
