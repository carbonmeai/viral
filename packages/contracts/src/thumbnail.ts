import { Schema } from "effect"
import { SourceIndex } from "./sources.ts"
import { ThumbConfig } from "./thumb-config.ts"

// A crop of a source frame as fractions of its width and height: [left, top, right, bottom], each 0–1.
export const FrameCrop = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])
export type FrameCrop = typeof FrameCrop.Type

export const ThumbnailColor = Schema.Literals(["yellow", "white", "red"])
export type ThumbnailColor = typeof ThumbnailColor.Type

// The bold layout's gradient, by name: red, yellow (orange edge), orange, blue, purple, green or pink.
export const BackdropColor = Schema.Literals(["red", "yellow", "orange", "blue", "purple", "green", "pink"])
export type BackdropColor = typeof BackdropColor.Type

// What the thumbnail agent proposes: the layout, the moments, the crops and the words; the server places
// everything. Times are source seconds.
//   bold (the default): a saturated gradient, the hero and the face cut out of their frames with thick outlines,
//     the face big and overlapping the hero, curiosity words, an arrow to the hero and/or one emoji.
//   classic: the hand-made candy thumbnail's layout (a blurred frame, framed hero, tilted face inset).
export const ThumbnailProposal = Schema.Struct({
  // absent = bold
  layout: Schema.optionalKey(Schema.Literals(["bold", "classic"])),
  // classic: the frame blurred and darkened behind everything. bold: `color` names the gradient (src unused)
  background: Schema.Struct({ src: Schema.Finite, color: Schema.optionalKey(BackdropColor), source: Schema.optionalKey(SourceIndex) }),
  // the hero object, big in the middle; `circle` rings it (centre and radius as fractions of the cropped
  // image), or null for no circle
  hero: Schema.Struct({
    src: Schema.Finite,
    // which of the short's videos it's from (V1 = 0); leave it out when the short has one video
    source: Schema.optionalKey(SourceIndex),
    crop: FrameCrop,
    circle: Schema.NullOr(Schema.Struct({ x: Schema.Finite, y: Schema.Finite, r: Schema.Finite }))
  }),
  // the strongest reaction face, cropped to head and shoulders; bold puts it big on `side` (default right).
  // null when the video has none worth showing (classic only: bold needs a face)
  face: Schema.NullOr(Schema.Struct({
    src: Schema.Finite,
    source: Schema.optionalKey(SourceIndex),
    crop: FrameCrop,
    side: Schema.optionalKey(Schema.Literals(["left", "right"]))
  })),
  // one or two lines of huge text at the top: 2–4 words (classic) or 2–5 (bold)
  lines: Schema.Array(Schema.Struct({ text: Schema.String, color: ThumbnailColor })),
  // bold: a red arrow from the empty side to the hero (default on), and/or one emoji there
  arrow: Schema.optionalKey(Schema.Boolean),
  emoji: Schema.optionalKey(Schema.NullOr(Schema.String))
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
