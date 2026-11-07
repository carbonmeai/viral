import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { AdRange } from "./ads.ts"
import { Project } from "./projects.ts"
import { Run, StageRun } from "./runs.ts"
import {
  MAX_SHORT_SOURCES,
  Source,
  SourceId,
  SourceIndex,
  SourceNotFound,
  SourceSetId,
  VideoSetNotFound
} from "./sources.ts"
import { Proposal, StoryBeat, StoryQuote } from "./story.ts"

// A group of 2–10 videos you want shorts from, in the order you gave them (V1 first), with the brief that says
// why they belong together. Its run reads each video, then proposes shorts across them.
export const VideoSet = Schema.Struct({
  id: SourceSetId,
  title: Schema.String,
  brief: Schema.String,
  sourceIds: Schema.Array(SourceId),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString
})
export type VideoSet = typeof VideoSet.Type

// What the agent proposes, numbering the videos as it reads them: V1 = 1. The server checks it and stores a
// SetStory, whose `source` fields are set positions (V1 = 0) like every other clip reference.
export const VideoNumber = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_SHORT_SOURCES }))

export const ProposedSetBeat = Schema.Struct({
  // which video the beat is in
  video: VideoNumber,
  beat: StoryBeat.fields.beat,
  // seconds in that video
  start: Schema.Finite,
  end: Schema.Finite,
  summary: Schema.String,
  // the strongest real lines in it, quoted exactly as that video's transcript has them
  quotes: Schema.Array(StoryQuote)
})

export const ProposedSetProposal = Schema.Struct({
  ...Proposal.fields,
  // the videos this short uses, at least two
  videos: Schema.Array(VideoNumber)
})

export const ProposedSetStory = Schema.Struct({
  // the story across the videos: what joins them, in a sentence or two
  summary: Schema.String,
  // each video in a line: what it brings to the set
  videos: Schema.Array(Schema.Struct({ video: VideoNumber, summary: Schema.String })),
  beats: Schema.Array(ProposedSetBeat),
  proposals: Schema.Array(ProposedSetProposal)
})
export type ProposedSetStory = typeof ProposedSetStory.Type

// A beat in one of the set's videos, with its quotes snapped to that video's transcript.
export const SetStoryBeat = Schema.Struct({
  source: SourceIndex,
  beat: StoryBeat.fields.beat,
  start: Schema.Finite,
  end: Schema.Finite,
  summary: Schema.String,
  quotes: Schema.Array(StoryQuote)
})
export type SetStoryBeat = typeof SetStoryBeat.Type

// One short across the set's videos: its approach, title, hook and scores, and which videos it uses (set
// positions, in set order). "Make this short" makes a short from those videos.
export const SetProposal = Schema.Struct({
  ...Proposal.fields,
  sources: Schema.Array(SourceIndex)
})
export type SetProposal = typeof SetProposal.Type

// The set-story artifact: the story across the videos, each video's part in it, the beats per video, and three
// proposals, best first.
export const SetStory = Schema.Struct({
  summary: Schema.String,
  videos: Schema.Array(Schema.Struct({ source: SourceIndex, summary: Schema.String })),
  beats: Schema.Array(SetStoryBeat),
  proposals: Schema.Array(SetProposal)
})
export type SetStory = typeof SetStory.Type

// One of the set's videos on the set page: the video, how far it has been read (its latest source run), and what
// the set story needs from it.
export const VideoSetMember = Schema.Struct({
  // V1 = 0
  position: SourceIndex,
  source: Source,
  run: Schema.NullOr(Run),
  stages: Schema.Array(StageRun),
  // its transcript, contact sheets and ad ranges are all there
  ready: Schema.Boolean,
  words: Schema.NullOr(Schema.Int),
  ads: Schema.Array(AdRange)
})
export type VideoSetMember = typeof VideoSetMember.Type

// A short made from this set, with the proposal it came from (null when it can't tell).
export const VideoSetShort = Schema.Struct({ project: Project, proposal: Schema.NullOr(Schema.Int) })
export type VideoSetShort = typeof VideoSetShort.Type

// Everything a set's page shows: the set, its videos, its latest run (the set story), the story and proposals,
// and the shorts made from it.
export const VideoSetOverview = Schema.Struct({
  set: VideoSet,
  members: Schema.Array(VideoSetMember),
  run: Schema.NullOr(Run),
  stages: Schema.Array(StageRun),
  story: Schema.NullOr(SetStory),
  shorts: Schema.Array(VideoSetShort)
})
export type VideoSetOverview = typeof VideoSetOverview.Type

// The videos asked for don't make a set: fewer than 2, more than 10, one twice, or no brief.
export class VideoSetInvalid extends Schema.TaggedError<VideoSetInvalid>()("VideoSetInvalid", {
  message: Schema.String
}) {}

// A set can't be deleted while shorts made from it exist; delete those first.
export class VideoSetInUse extends Schema.TaggedError<VideoSetInUse>()("VideoSetInUse", {
  id: SourceSetId,
  shorts: Schema.Int,
  message: Schema.String
}) {}

export class VideoSetsRpcs extends RpcGroup.make(
  // A set from 2–10 of your videos, V1 first, with a brief (why they belong together). Without a title it's
  // named from the brief.
  Rpc.make("CreateVideoSet", {
    payload: { sourceIds: Schema.Array(SourceId), brief: Schema.String, title: Schema.optionalKey(Schema.NullOr(Schema.String)) },
    success: VideoSet,
    error: Schema.Union([VideoSetInvalid, SourceNotFound])
  }),
  // Every set, newest first.
  Rpc.make("ListVideoSets", { success: Schema.Array(VideoSet) }),
  Rpc.make("GetVideoSetOverview", { payload: { id: SourceSetId }, success: VideoSetOverview, error: VideoSetNotFound }),
  Rpc.make("RenameVideoSet", { payload: { id: SourceSetId, title: Schema.String }, success: VideoSet, error: Schema.Union([VideoSetNotFound, VideoSetInvalid]) }),
  // Deletes the set and its own work (never its videos); false when it's unknown. Refused while shorts from it exist.
  Rpc.make("DeleteVideoSet", { payload: { id: SourceSetId }, success: Schema.Boolean, error: VideoSetInUse })
) {}
