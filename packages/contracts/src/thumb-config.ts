import { Schema } from "effect"
import { PiecesBySource } from "./sources.ts"

// Mirrors thumb.json, the config thumbnail.py reads. Keys stay snake_case to match the script.

// Pixel crop box in the source frame: [left, top, right, bottom].
const CropBox = Schema.Tuple([Schema.Int, Schema.Int, Schema.Int, Schema.Int])

// Which of the config's videos a layer is cut from: 0 = `source` (V1), 1 = `sources[0]` (V2)… Absent = V1, so a
// single-video config is written exactly as before.
const LayerSource = { source: Schema.optionalKey(Schema.Int) }

const Layer = {
  src: Schema.Finite,
  ...LayerSource,
  box: Schema.optionalKey(CropBox),
  // placement as fractions of the canvas
  x: Schema.optionalKey(Schema.Finite),
  y: Schema.Finite,
  width: Schema.optionalKey(Schema.Finite)
}

// classic: the skill's layout (a blurred frame behind framed insets). bold: a saturated gradient behind the hero
// and the face lifted out of their frames with outlines, curiosity words, an arrow and/or an emoji.
export const ThumbLayout = Schema.Literals(["classic", "bold"])
export type ThumbLayout = typeof ThumbLayout.Type

export const ThumbConfig = Schema.Struct({
  // absent = classic, the original layout
  layout: Schema.optionalKey(ThumbLayout),
  source: Schema.String,
  // a short's other videos, V2 first: a layer with `source: 1` is cut from the first of these
  sources: Schema.optionalKey(Schema.Array(Schema.String)),
  // full-quality pieces of scanned videos, by video index: a layer's frame comes from the piece covering its second,
  // and its `box` (in the video's own pixels) is scaled to the piece's size. Added when drawing; never stored.
  pieces_by_source: Schema.optionalKey(PiecesBySource),
  background: Schema.Struct({ src: Schema.Finite, ...LayerSource }),
  // bold: the gradient behind everything, centre colour then edge colour, with an optional burst of rays
  backdrop: Schema.optionalKey(Schema.Struct({
    colors: Schema.Tuple([Schema.String, Schema.String]),
    burst: Schema.optionalKey(Schema.Boolean)
  })),
  hero: Schema.Struct({
    ...Layer,
    circle: Schema.optionalKey(Schema.Boolean),
    circle_x: Schema.optionalKey(Schema.Finite),
    circle_y: Schema.optionalKey(Schema.Finite),
    circle_r: Schema.optionalKey(Schema.Finite),
    // bold: degrees, the cut-out's outline colour, and the glow behind it
    rotate: Schema.optionalKey(Schema.Finite),
    outline: Schema.optionalKey(Schema.String),
    glow: Schema.optionalKey(Schema.String)
  }),
  // the reaction face: a tilted inset (classic), or a big cut-out anchored to the bottom (bold)
  inset: Schema.optionalKey(Schema.Struct({
    ...Layer,
    tilt: Schema.optionalKey(Schema.Finite),
    // bold: its height as a fraction of the canvas, the side it sits on, and its outline colour
    height: Schema.optionalKey(Schema.Finite),
    side: Schema.optionalKey(Schema.Literals(["left", "right"])),
    outline: Schema.optionalKey(Schema.String)
  })),
  lines: Schema.Array(Schema.Struct({
    text: Schema.String,
    color: Schema.optionalKey(Schema.String),
    size: Schema.optionalKey(Schema.Int)
  })),
  text_y: Schema.optionalKey(Schema.Finite),
  arrow: Schema.optionalKey(Schema.Boolean),
  // bold: one emoji, centred at x, y (fractions of the canvas), `size` px wide
  emoji: Schema.optionalKey(Schema.Struct({
    char: Schema.String,
    x: Schema.optionalKey(Schema.Finite),
    y: Schema.optionalKey(Schema.Finite),
    size: Schema.optionalKey(Schema.Int)
  }))
})
export type ThumbConfig = typeof ThumbConfig.Type
