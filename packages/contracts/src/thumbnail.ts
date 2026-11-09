import { Schema } from "effect"
import { SourceIndex, VideoNumber } from "./sources.ts"
import { ThumbConfig } from "./thumb-config.ts"

// A crop of a source frame as fractions of its width and height: [left, top, right, bottom], each 0–1.
export const FrameCrop = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])
export type FrameCrop = typeof FrameCrop.Type

export const ThumbnailColor = Schema.Literals(["yellow", "white", "red"])
export type ThumbnailColor = typeof ThumbnailColor.Type

// The bold layout's gradient, by name: red, yellow (orange edge), orange, blue, purple, green or pink.
export const BackdropColor = Schema.Literals(["red", "yellow", "orange", "blue", "purple", "green", "pink"])
export type BackdropColor = typeof BackdropColor.Type

// A thumbnail's layers without their video; the stored proposal adds `source` (position), the agent's `video`.
const BackgroundLayer = { src: Schema.Finite, color: Schema.optionalKey(BackdropColor) }
const HeroLayer = {
  src: Schema.Finite,
  crop: FrameCrop,
  circle: Schema.NullOr(Schema.Struct({ x: Schema.Finite, y: Schema.Finite, r: Schema.Finite }))
}
const FaceLayer = { src: Schema.Finite, crop: FrameCrop, side: Schema.optionalKey(Schema.Literals(["left", "right"])) }
const Words = {
  // one or two lines of huge text at the top: 2–4 words (classic) or 2–5 (bold)
  lines: Schema.Array(Schema.Struct({ text: Schema.String, color: ThumbnailColor })),
  // bold: a red arrow from the empty side to the hero (default on), and/or one emoji there
  arrow: Schema.optionalKey(Schema.Boolean),
  emoji: Schema.optionalKey(Schema.NullOr(Schema.String))
}
// absent = bold
const Layout = { layout: Schema.optionalKey(Schema.Literals(["bold", "classic"])) }

// What the thumbnail agent proposes: the layout, the moments, the crops and the words; the server places
// everything. Times are source seconds; each layer's `source` is which of the short's videos it's from (V1 = 0, left
// out for V1, so a single-video short's thumbnail is stored as before).
//   bold (the default): a saturated gradient, the hero and the face cut out of their frames with thick outlines,
//     the face big and overlapping the hero, curiosity words, an arrow to the hero and/or one emoji.
//   classic: the hand-made candy thumbnail's layout (a blurred frame, framed hero, tilted face inset).
//   background — classic: the frame blurred and darkened behind everything. bold: `color` names the gradient (src unused)
//   hero — the hero object, big in the middle; `circle` rings it (centre and radius as fractions of the cropped
//     image), or null for no circle
//   face — the strongest reaction face, cropped to head and shoulders; bold puts it big on `side` (default right).
//     null when the video has none worth showing (classic only: bold needs a face)
const Source = { source: Schema.optionalKey(SourceIndex) }
export const ThumbnailProposal = Schema.Struct({
  ...Layout,
  background: Schema.Struct({ ...BackgroundLayer, ...Source }),
  hero: Schema.Struct({ ...HeroLayer, ...Source }),
  face: Schema.NullOr(Schema.Struct({ ...FaceLayer, ...Source })),
  ...Words
})
export type ThumbnailProposal = typeof ThumbnailProposal.Type

// What the thumbnail agent sends: the same, but each layer names its video by its V number (`video`, absent = V1).
// The server checks it and keeps a ThumbnailProposal, whose `source` is the position (V2 = 1).
const Video = { video: Schema.optionalKey(VideoNumber) }
export const ProposedThumbnail = Schema.Struct({
  ...Layout,
  background: Schema.Struct({ ...BackgroundLayer, ...Video }),
  hero: Schema.Struct({ ...HeroLayer, ...Video }),
  face: Schema.NullOr(Schema.Struct({ ...FaceLayer, ...Video })),
  ...Words
})
export type ProposedThumbnail = typeof ProposedThumbnail.Type

// The approved thumbnail: the renderer's config (pixel crops, the source video's path) and the image, a jpg
// next to it in the artifact's folder.
export const Thumbnail = Schema.Struct({
  // the agent's proposal; null when the thumbnail is your edited config
  proposal: Schema.NullOr(ThumbnailProposal),
  config: ThumbConfig,
  image: Schema.NullOr(Schema.String)
})
export type Thumbnail = typeof Thumbnail.Type
