import { Schema } from "effect"

// Mirrors thumb.json, the config thumbnail.py reads. Keys stay snake_case to match the script.

// Pixel crop box in the source frame: [left, top, right, bottom].
const CropBox = Schema.Tuple([Schema.Int, Schema.Int, Schema.Int, Schema.Int])

const Layer = {
  src: Schema.Finite,
  box: Schema.optionalKey(CropBox),
  // placement as fractions of the canvas
  x: Schema.optionalKey(Schema.Finite),
  y: Schema.Finite,
  width: Schema.optionalKey(Schema.Finite)
}

export const ThumbConfig = Schema.Struct({
  source: Schema.String,
  background: Schema.Struct({ src: Schema.Finite }),
  hero: Schema.Struct({
    ...Layer,
    circle: Schema.optionalKey(Schema.Boolean),
    circle_x: Schema.optionalKey(Schema.Finite),
    circle_y: Schema.optionalKey(Schema.Finite),
    circle_r: Schema.optionalKey(Schema.Finite)
  }),
  // tilted reaction-face inset
  inset: Schema.optionalKey(Schema.Struct({ ...Layer, tilt: Schema.optionalKey(Schema.Finite) })),
  lines: Schema.Array(Schema.Struct({
    text: Schema.String,
    color: Schema.optionalKey(Schema.String),
    size: Schema.optionalKey(Schema.Int)
  })),
  text_y: Schema.optionalKey(Schema.Finite),
  arrow: Schema.optionalKey(Schema.Boolean)
})
export type ThumbConfig = typeof ThumbConfig.Type
