import { Schema } from "effect"
import { PiecesBySource } from "./sources.ts"

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

// Which of the plan's videos a clip plays from: 0 = `source` (V1), 1 = `sources[0]` (V2)… Absent = V1, so a
// single-video plan is written exactly as before.
const ClipSource = { source: Schema.optionalKey(Schema.Int) }

export const NarratedShot = Schema.Struct({
  src: Seconds,
  ...ClipSource,
  ...WordAnchor,
  ...Framing,
  speed: Schema.optionalKey(Schema.Finite),
  note: Schema.optionalKey(Schema.String)
})
export type NarratedShot = typeof NarratedShot.Type

// A real-voice clip played *during* the narration: the voiceover pauses after word `after_word`, the clip
// plays with its own audio, then the voiceover resumes (at `resume_word` when set). Everything later shifts by the
// clip's length.
export const NarratedInsert = Schema.Struct({
  start: Seconds,
  end: Seconds,
  ...ClipSource,
  after_word: Schema.Int,
  after_word_text: Schema.optionalKey(Schema.String),
  // the narration picks up from this voiceover word instead (from 0.08 s before it), skipping the words between, which
  // the clip says anyway; absent = it resumes where it paused
  resume_word: Schema.optionalKey(Schema.Int),
  resume_word_text: Schema.optionalKey(Schema.String),
  ...Framing,
  captions: Schema.optionalKey(Schema.Boolean),
  note: Schema.optionalKey(Schema.String)
})
export type NarratedInsert = typeof NarratedInsert.Type

// The creator's real audio, appended after the narration.
export const NarratedOutro = Schema.Struct({
  start: Seconds,
  end: Seconds,
  ...ClipSource,
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

// A block of an arranged music bed (music_bed.py's `arrange`): the song's bars `from_bar`–`to_bar` (bar 0 is the
// earliest whole bar before the drop, so the drop sits on a bar line), played `loops` times, straight after the
// block before it or, with `word`, starting exactly on that voiceover word.
export const MusicArrangementBlockConfig = Schema.Struct({
  from_bar: Schema.Int,
  to_bar: Schema.Int,
  loops: Schema.Int,
  word: Schema.optionalKey(Schema.Int)
})
export type MusicArrangementBlockConfig = typeof MusicArrangementBlockConfig.Type

// Bar-aligned music bed: the build loops in whole bars so `drop` lands on `drop_word` (or `drop_at`); with an
// `arrangement`, the song's blocks are laid out as it says instead.
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
  arrangement: Schema.optionalKey(Schema.Array(MusicArrangementBlockConfig)),
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
  // the short's other videos, V2 first: a clip with `source: 1` plays from the first of these
  sources: Schema.optionalKey(Schema.Array(Schema.Struct({ path: Schema.String, transcript: Schema.optionalKey(Schema.String) }))),
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
  // the same for the other videos, by clip source index ("1" = V2); `exclude` stays V1's
  exclude_by_source: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(SourceRange))),
  exclude_note: Schema.optionalKey(Schema.String),
  // full-quality pieces of scanned videos, by video index ("0" = V1); absent = every clip plays from its video
  pieces_by_source: Schema.optionalKey(PiecesBySource),
  narration_end: Schema.optionalKey(Seconds),
  shots: Schema.Array(NarratedShot),
  inserts: Schema.optionalKey(Schema.Array(NarratedInsert)),
  outro: Schema.optionalKey(Schema.Array(NarratedOutro)),
  annotations: Schema.optionalKey(Schema.Array(NarratedAnnotation)),
  // absent = no sound effects, and the render is exactly as before
  sfx: Schema.optionalKey(Schema.Array(SfxCue)),
  sfx_gain: Schema.optionalKey(Schema.Finite),
  music: Schema.optionalKey(Schema.Union([Schema.String, MusicConfig])),
  // the short's music already fitted at assemble time (fit-music.py): the renderer plays it as it is instead of
  // fitting `music` again
  music_bed: Schema.optionalKey(Schema.Struct({ file: Schema.String, drop_at: Seconds })),
  music_gain: Schema.optionalKey(Schema.Finite),
  music_start: Schema.optionalKey(Seconds),
  duck_ratio: Schema.optionalKey(Schema.Finite),
  duck_threshold: Schema.optionalKey(Schema.Finite),
  voice_gain: Schema.optionalKey(Schema.Finite),
  // short fades where real clips and narration pieces meet (clips in 0.06 s / out 0.15 s, narration 0.04 / 0.12), so
  // raw audio never pops in or out against the narrator; absent = hard cuts, the render exactly as before
  soft_joins: Schema.optionalKey(Schema.Boolean),
  // a breath after an insert's word before the clip (seconds, at most half way to the next word); absent = the
  // clip starts as the word ends
  insert_pad: Schema.optionalKey(Seconds),
  lufs: Schema.optionalKey(Schema.Finite)
})
export type NarratedPlan = typeof NarratedPlan.Type
