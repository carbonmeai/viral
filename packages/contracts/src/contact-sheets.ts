import { Schema } from "effect"

// A contact-sheet artifact's data: timestamped frame grids of a video, and every frame on its own.
export const ContactSheetSet = Schema.Struct({
  every: Schema.Finite,
  cols: Schema.Int,
  rows: Schema.Int,
  frames: Schema.Int,
  // each sheet's file (relative to the artifact folder) and the source seconds of its first/last tile
  sheets: Schema.Array(Schema.Struct({ file: Schema.String, start: Schema.Finite, end: Schema.Finite })),
  // every frame on its own (relative to the artifact folder) with its source second, so a client can show
  // or offer any one of them; absent on sheets made before frames were kept
  stills: Schema.optionalKey(Schema.Array(Schema.Struct({ file: Schema.String, t: Schema.Finite })))
})
export type ContactSheetSet = typeof ContactSheetSet.Type
