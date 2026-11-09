import { Schema } from "effect"
import { RenderChecks } from "./ranking-plan.ts"

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
  footage: Schema.optionalKey(Schema.Array(RenderFootage))
})
export type RenderedShort = typeof RenderedShort.Type
