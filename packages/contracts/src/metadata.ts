import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { ProjectId, ProjectNotFound } from "./projects.ts"
import { Run } from "./runs.ts"

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

// The text you post a short with: the title you chose (the agent's, an alternate, or your own words), the
// description and the hashtags.
export const PostText = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  hashtags: Schema.Array(Schema.String)
})
export type PostText = typeof PostText.Type

// The finished short: the files in ~/.viral/renders/ and what to post it with.
export const PublishedShort = Schema.Struct({
  ...ShortMetadata.fields,
  credit: Schema.NullOr(Schema.String),
  video: Schema.String,
  captions: Schema.String,
  // the post text as markdown, next to the video
  notes: Schema.String,
  // the post text the files were written with (absent on older versions: the agent's title, description and
  // hashtags)
  posted: Schema.optionalKey(PostText),
  // the render version the published mp4 is a copy of (absent on older versions)
  renderVersion: Schema.optionalKey(Schema.Int)
})
export type PublishedShort = typeof PublishedShort.Type

// What publishing again would change in the renders folder: your post text, the credit line, a newer render to
// copy, or files that went missing there.
export const PublishChange = Schema.Literals(["title", "description", "hashtags", "credit", "video", "missing"])
export type PublishChange = typeof PublishChange.Type

// A published short's post text and what "Publish again" would do.
export const PublishStatus = Schema.Struct({
  // what you'll post with: your choice and edits, else the agent's
  post: PostText,
  // the post text is yours (a title you chose or edited, or edited words), not the agent's pick
  edited: Schema.Boolean,
  // the description's credit line as it reads now, null when there's no one to credit
  credit: Schema.NullOr(Schema.String),
  // what publishing again would update; empty when the files are current
  changes: Schema.Array(PublishChange),
  // the credit drawn on the video changed (a video's rights or channel, or the style): publishing again re-renders
  // the video first (assemble and render, no agent work), which you approve, then replaces the files
  rerender: Schema.Boolean,
  // the files it writes into the renders folder ("02-candy.mp4", …)
  files: Schema.Array(Schema.String),
  // published files it would remove because the new ones have other names
  replaces: Schema.Array(Schema.String),
  // a run of the short is going, so it can't publish now
  busy: Schema.Boolean
})
export type PublishStatus = typeof PublishStatus.Type

export class NotPublished extends Schema.TaggedError<NotPublished>()("NotPublished", {
  id: ProjectId
}) {}

// Post text that can't be used, in plain words (one problem per line).
export class PostTextInvalid extends Schema.TaggedError<PostTextInvalid>()("PostTextInvalid", {
  problems: Schema.Array(Schema.String)
}) {}

// Publishing can't happen now (a run of the short is going, or the render is missing).
export class PublishUnavailable extends Schema.TaggedError<PublishUnavailable>()("PublishUnavailable", {
  message: Schema.String
}) {}

export class PublishRpcs extends RpcGroup.make(
  Rpc.make("GetPublishStatus", {
    payload: { projectId: ProjectId },
    success: PublishStatus,
    error: Schema.Union([ProjectNotFound, NotPublished])
  }),
  // Saves the text to post with (null: back to the agent's), checked first: a title of 1–100 characters (YouTube's
  // limit), a description, # hashtags. The files change when you publish again.
  Rpc.make("SetPostText", {
    payload: { projectId: ProjectId, post: Schema.NullOr(PostText) },
    success: PublishStatus,
    error: Schema.Union([ProjectNotFound, NotPublished, PostTextInvalid])
  }),
  // Rewrites the short's files in the renders folder (mp4, srt and <slug>.md) with your post text, the credit as it
  // is now and the latest render, replacing the old ones. When the credit drawn on the video changed, it re-runs
  // the short's assemble and render first (no agents; the render waits for your approval) and publishes once the
  // run finishes: the result is that run.
  Rpc.make("PublishAgain", {
    payload: { projectId: ProjectId },
    success: Schema.Union([
      Schema.TaggedStruct("Published", { status: PublishStatus }),
      Schema.TaggedStruct("Rendering", { run: Run })
    ]),
    error: Schema.Union([ProjectNotFound, NotPublished, PublishUnavailable])
  })
) {}
