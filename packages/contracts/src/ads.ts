import { Schema } from "effect"

// Parts of the long video that must never appear in a short.
export const AdKind = Schema.Literals(["sponsor", "ad", "end-screen", "qr", "intro"])
export type AdKind = typeof AdKind.Type

export const AdRange = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  kind: AdKind,
  // what gave it away, e.g. "This video has been sponsored by Brilliant"
  evidence: Schema.String
})
export type AdRange = typeof AdRange.Type

export const AdRanges = Schema.Struct({ ranges: Schema.Array(AdRange) })
export type AdRanges = typeof AdRanges.Type
