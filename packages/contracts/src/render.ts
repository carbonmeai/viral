import { Schema } from "effect"

// A rendered short, as the render gate shows it. Paths are absolute.
export const RenderedShort = Schema.Struct({
  video: Schema.String,
  captions: Schema.String,
  durationS: Schema.Finite,
  shots: Schema.Int,
  // a frame per second of the render in one image, for checking every shot against its words by eye
  checkSheet: Schema.NullOr(Schema.String)
})
export type RenderedShort = typeof RenderedShort.Type
