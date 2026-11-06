import { Schema } from "effect"

// What a short is posted with. The credit line (when the footage isn't yours) is added by the server.
export const ShortMetadata = Schema.Struct({
  // under 40 characters
  title: Schema.String,
  // two or three other titles to A/B test
  alternates: Schema.Array(Schema.String),
  // two sentences, third person, no spoiler
  description: Schema.String,
  // "#shorts" first
  hashtags: Schema.Array(Schema.String)
})
export type ShortMetadata = typeof ShortMetadata.Type

// The finished short: the files in ~/.viral/renders/ and what to post it with.
export const PublishedShort = Schema.Struct({
  ...ShortMetadata.fields,
  credit: Schema.NullOr(Schema.String),
  video: Schema.String,
  captions: Schema.String,
  // the post text as markdown, next to the video
  notes: Schema.String
})
export type PublishedShort = typeof PublishedShort.Type
