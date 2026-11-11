import { Schema } from "effect"
import { RenderChecks } from "./ranking-plan.ts"
import { TranscriptProvider } from "./transcript.ts"

// Where one video's footage in a render came from, for a video found by research (read from a 480p scan): `clips`
// played from its full-quality pieces, `scanClips` from the 480p copy. `problem` says why any did, in plain words
// (the pieces couldn't be fetched: YouTube refused twice, the network…); a render is never quietly worse.
export const RenderFootage = Schema.Struct({
  // the video's position in the short (V1 = 0)
  video: Schema.Int,
  title: Schema.NullOr(Schema.String),
  // the pieces fetched for this render, and their height (1080 when YouTube has it)
  pieces: Schema.Int,
  height: Schema.NullOr(Schema.Int),
  // the scan's height (480)
  scanHeight: Schema.NullOr(Schema.Int),
  clips: Schema.Int,
  scanClips: Schema.Int,
  problem: Schema.NullOr(Schema.String)
})
export type RenderFootage = typeof RenderFootage.Type

// One line of the read-back: what the finished mp4 was heard to say against what it should say. `ok` false is a warning
// for your eye (it never blocks approving); `at` is the moment of the short it's about (seconds), for seeking there.
export const ReadBackKind = Schema.Literals(["heard", "narration", "real-line", "skipped", "closing", "countdown", "join", "silence"])
export type ReadBackKind = typeof ReadBackKind.Type
export const ReadBackCheck = Schema.Struct({
  kind: ReadBackKind,
  ok: Schema.Boolean,
  text: Schema.String,
  at: Schema.NullOr(Schema.Finite)
})
export type ReadBackCheck = typeof ReadBackCheck.Type

// The final-video check (the skill's "transcribe the FINAL mp4 and read every line"): the render's audio transcribed
// (local Whisper unless you chose Grok) and read back against the plan. `problem` says why it couldn't run (no
// transcriber, VIRAL_READ_BACK=off…), and then `checks` is empty.
export const ReadBack = Schema.Struct({
  provider: Schema.NullOr(TranscriptProvider),
  // how long transcribing and reading took
  seconds: Schema.Finite,
  // the final transcript (transcript.json, absolute), null when it couldn't run
  transcript: Schema.NullOr(Schema.String),
  checks: Schema.Array(ReadBackCheck),
  problem: Schema.NullOr(Schema.String)
})
export type ReadBack = typeof ReadBack.Type

// A rendered short, as the render gate shows it. Paths are absolute.
export const RenderedShort = Schema.Struct({
  video: Schema.String,
  captions: Schema.String,
  durationS: Schema.Finite,
  shots: Schema.Int,
  // a frame per second of the render in one image, for checking every shot against its words by eye
  checkSheet: Schema.NullOr(Schema.String),
  // a ranking's checks of the finished mp4 (black frames, each shot's first and last frame, loudness)
  checks: Schema.optionalKey(RenderChecks),
  // one row per video read from a 480p scan; absent when every video is a full download or your own file
  footage: Schema.optionalKey(Schema.Array(RenderFootage)),
  // the finished mp4 read back; absent on renders made before it existed
  readBack: Schema.optionalKey(ReadBack)
})
export type RenderedShort = typeof RenderedShort.Type
