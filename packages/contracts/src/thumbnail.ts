import { Schema } from "effect"
import { ThumbConfig } from "./thumb-config.ts"

// A crop of a source frame as fractions of its width and height: [left, top, right, bottom], each 0–1.
export const FrameCrop = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])
export type FrameCrop = typeof FrameCrop.Type

export const ThumbnailColor = Schema.Literals(["yellow", "white", "red"])
export type ThumbnailColor = typeof ThumbnailColor.Type

// What the thumbnail agent proposes. The layout is fixed (the hand-made candy thumbnail's); the agent picks
// the moments, the crops and the words. Times are source seconds.
export const ThumbnailProposal = Schema.Struct({
  // blurred and darkened behind everything
  background: Schema.Struct({ src: Schema.Finite }),
  // the hero object, big in the middle; `circle` rings it (centre and radius as fractions of the cropped
  // image), or null for no circle
  hero: Schema.Struct({
    src: Schema.Finite,
    crop: FrameCrop,
    circle: Schema.NullOr(Schema.Struct({ x: Schema.Finite, y: Schema.Finite, r: Schema.Finite }))
  }),
  // a reaction face, tilted in the lower right; null when the video has none worth showing
  face: Schema.NullOr(Schema.Struct({ src: Schema.Finite, crop: FrameCrop })),
  // one or two lines of huge text at the top, 2–4 words in all
  lines: Schema.Array(Schema.Struct({ text: Schema.String, color: ThumbnailColor }))
})
export type ThumbnailProposal = typeof ThumbnailProposal.Type

// The approved thumbnail: the renderer's config (pixel crops, the source video's path) and the image, a jpg
// next to it in the artifact's folder.
export const Thumbnail = Schema.Struct({
  // the agent's proposal; null when the thumbnail is your edited config
  proposal: Schema.NullOr(ThumbnailProposal),
  config: ThumbConfig,
  image: Schema.NullOr(Schema.String)
})
export type Thumbnail = typeof Thumbnail.Type
