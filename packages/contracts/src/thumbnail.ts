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


// ── AI thumbnails (the short-thumbnail skill) ──────────────────────────────────────────────────────────────────────
// An image model composes the thumbnail from REAL frames of the short's videos: two or three real reactions, the real
// hero object and (when the video has one) a real on-screen graphic, in four bands top to bottom: the graphic, 1–3
// huge outlined words, the hero made dramatic with an escalation row, and the real reactions side by side. The agent
// picks the frames and writes the bands; the server extracts the frames, builds the prompt and asks for three options.

// The image model and its settings, as the skill made the approved thumbnail (ElevenLabs' Image & Video API; the AI
// Gateway serves the same model as openai/gpt-image-2.5-sunburst).
export const THUMBNAIL_IMAGE_MODEL = "gpt-image-2.5-sunburst"
export const THUMBNAIL_OPTIONS = 3
// What one 9:16 2K "high" image cost in ElevenLabs credits when the skill made the approved thumbnail (~1,245 credits,
// about $0.25). ElevenLabs doesn't report a generation's bill, so this estimate is what's recorded.
export const THUMBNAIL_IMAGE_CREDITS = 1245
// About what a credit costs on a plan whose price isn't known ($0.25 for 1,245 credits, as the skill saw it).
export const THUMBNAIL_USD_PER_CREDIT = 0.25 / 1245
// A round of options: its credits and dollars, before it's made.
export const thumbnailRoundCredits = (options: number = THUMBNAIL_OPTIONS) => options * THUMBNAIL_IMAGE_CREDITS
// What the AI Gateway charged an image at its defaults when M4 was checked live ($0.18 reported for a round of 3). The
// Gateway reports each call's real cost, so this is only the estimate said before Generate.
export const THUMBNAIL_GATEWAY_USD_PER_IMAGE = 0.06

// A real frame the image model gets: a second of one of the short's videos and what it shows.
const DesignFrameFields = { src: Schema.Finite }
const DesignFields = <F extends Schema.Struct.Fields>(frame: F) => ({
  // a real on-screen graphic from the video (a score bar, a scale, a level card, a price tag), reproduced across the
  // top; null when the video has none
  graphic: Schema.NullOr(Schema.Struct({ ...DesignFrameFields, ...frame, what: Schema.String })),
  // 1–3 words of huge white text with a thick black outline ("LEVEL 10", "TOP 1")
  words: Schema.String,
  // the hero object's real frame, what it is, and how to make it dramatic ("cracked open with glowing molten lava")
  hero: Schema.Struct({ ...DesignFrameFields, ...frame, what: Schema.String, dramatise: Schema.String }),
  // the supporting row under the hero that shows escalation ("8 peppers from a green bell pepper to a flaming reaper")
  escalation: Schema.NullOr(Schema.String),
  // 2–3 real reactions of the person, left to right, each with what the face is doing
  reactions: Schema.Array(Schema.Struct({ ...DesignFrameFields, ...frame, look: Schema.String })),
  // who the reactions show, as they look (face, hair, clothes), so the model keeps them; never a name
  person: Schema.String,
  // a prop between the reactions ("a glass milk jug"); null for none
  prop: Schema.NullOr(Schema.String),
  // the background's colour and texture ("hyper-saturated fiery red-orange with flames and embers")
  background: Schema.String,
  // the person's name when they're a real public figure (the image model blocks real celebrities); null otherwise
  celebrity: Schema.NullOr(Schema.String)
})

// What the agent sends: each frame names its video by V number (`video`, absent = V1).
export const ProposedThumbnailDesign = Schema.Struct(DesignFields({ video: Schema.optionalKey(VideoNumber) }))
export type ProposedThumbnailDesign = typeof ProposedThumbnailDesign.Type

// As stored: each frame's `source` is its position among the short's videos (V1 = 0, left out for V1).
export const ThumbnailDesign = Schema.Struct(DesignFields({ source: Schema.optionalKey(SourceIndex) }))
export type ThumbnailDesign = typeof ThumbnailDesign.Type

// The agent's verdict on a round: how well each option's faces match the real reaction frames (0–10, 10 = the same
// person, photographically) and which one to use.
export const ThumbnailFaceCheck = Schema.Struct({ option: Schema.Int, faces: Schema.Finite, note: Schema.String })
export type ThumbnailFaceCheck = typeof ThumbnailFaceCheck.Type
export const ThumbnailPick = Schema.Struct({
  checks: Schema.Array(ThumbnailFaceCheck),
  // the option to use (1-based), or null when none is good enough
  recommended: Schema.NullOr(Schema.Int)
})
export type ThumbnailPick = typeof ThumbnailPick.Type

// One of a round's options: its image (a 1080×1920 jpg in the artifact's folder), or why the model didn't make it,
// and the agent's face check.
export const ThumbnailOption = Schema.Struct({
  image: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(Schema.String),
  faces: Schema.NullOr(Schema.Finite),
  note: Schema.NullOr(Schema.String)
})
export type ThumbnailOption = typeof ThumbnailOption.Type

// A round of AI options, stored with the thumbnail: the design, the prompt and the input frames (images 1–N, in the
// artifact's folder), the options, which one the agent recommends (1-based) and which one you chose.
export const GeneratedThumbnail = Schema.Struct({
  design: ThumbnailDesign,
  model: Schema.String,
  prompt: Schema.String,
  inputs: Schema.Array(Schema.Struct({ file: Schema.String, role: Schema.Literals(["reaction", "hero", "graphic"]), src: Schema.Finite, source: Schema.optionalKey(SourceIndex) })),
  options: Schema.Array(ThumbnailOption),
  recommended: Schema.NullOr(Schema.Int),
  chosen: Schema.NullOr(Schema.Int),
  // the round's ElevenLabs credits (estimated: completed images only; failed ones aren't charged); 0 on the Gateway
  credits: Schema.Finite,
  // who made the images: ElevenLabs' Image & Video API, or the AI Gateway (the same model) when ElevenLabs' plan can't
  service: Schema.optionalKey(Schema.Literals(["elevenlabs", "ai-gateway"])),
  // what the Gateway reported the round cost, in dollars (ElevenLabs bills credits instead)
  costUsd: Schema.optionalKey(Schema.Finite),
  // why the faces weren't sent (a real public figure), when they weren't
  heldBack: Schema.optionalKey(Schema.NullOr(Schema.String))
})
export type GeneratedThumbnail = typeof GeneratedThumbnail.Type

// Choosing one of a round's options at the gate (an Edit): that one becomes the thumbnail and is published.
export const ChooseThumbnailOption = Schema.Struct({ choose: Schema.Int })
export type ChooseThumbnailOption = typeof ChooseThumbnailOption.Type

// A short's thumbnail. AI (the default with an image key): `generated` holds the round, `image` is the option in use
// (the one you chose, else the agent's pick) and `config` is null. Basic (no image key, Decision 8): the renderer's
// config (pixel crops, the source video's path) drawn by render-thumbnail.py. `image` is a jpg in the artifact's folder.
export const Thumbnail = Schema.Struct({
  // the agent's basic proposal; null when the thumbnail is your edited config or an AI round
  proposal: Schema.NullOr(ThumbnailProposal),
  config: Schema.NullOr(ThumbConfig),
  image: Schema.NullOr(Schema.String),
  generated: Schema.optionalKey(GeneratedThumbnail)
})
export type Thumbnail = typeof Thumbnail.Type
