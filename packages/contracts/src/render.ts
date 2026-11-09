import { Schema } from "effect"
import { RenderChecks } from "./ranking-plan.ts"

// A rendered short, as the render gate shows it. Paths are absolute.
export const RenderedShort = Schema.Struct({
  video: Schema.String,
  captions: Schema.String,
  durationS: Schema.Finite,
  shots: Schema.Int,
  // a frame per second of the render in one image, for checking every shot against its words by eye
  checkSheet: Schema.NullOr(Schema.String),
  // a ranking's checks of the finished mp4 (black frames, each shot's first and last frame, loudness)
  checks: Schema.optionalKey(RenderChecks)
})
export type RenderedShort = typeof RenderedShort.Type
