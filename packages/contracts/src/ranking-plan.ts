import { Schema } from "effect"
import { SourceIndex, VideoNumber } from "./sources.ts"

// A ranking short ("Ranking Animal Comebacks"): one entry per video, each a little story told in that video's own
// clips with their own sound, a numbered list down the left that fills in as each entry plays, #1 last.

// What a shot shows in its entry's story: the animal before, being cared for, and after.
export const RankingRole = Schema.Literals(["before", "care", "after"])
export type RankingRole = typeof RankingRole.Type

// window: a landscape video in a 4:3 window over a blurred copy of itself (keeps about 75% of the frame) · fill: the
// footage fills the 9:16 screen (upright phone footage inside a widescreen file, or an upright video)
export const RankingFraming = Schema.Literals(["window", "fill"])
export type RankingFraming = typeof RankingFraming.Type

export const RANKING_LIMITS = {
  // a label on the list ("Horse who gave up")
  labelChars: 24,
  // the title on top, both parts together
  titleChars: 32,
  // shots per entry: before, care, after (#1 may take one more)
  shots: [3, 4] as const,
  // a shot plays at least this long once snapped to whole sentences
  minShot: 1,
  // videos that fade in from black: no shot starts before this
  minStart: 0.4,
  // how far a cut may move to finish or keep a whole sentence
  maxBack: 3,
  maxForward: 4,
  // the Shorts limit, and the shortest choice
  seconds: [60, 180] as const,
  entries: [2, 10] as const
}

// One shot of an entry, in source seconds of the entry's video.
export const RankingShot = Schema.Struct({
  role: RankingRole,
  start: Schema.Finite,
  end: Schema.Finite,
  // absent = the framing Viral detected for the video
  framing: Schema.optionalKey(RankingFraming),
  // horizontal centre of the window or crop, 0–1
  cropX: Schema.optionalKey(Schema.Finite),
  // what's on screen from its first to its last frame, in a few words
  note: Schema.String
})
export type RankingShot = typeof RankingShot.Type

// "Ranking Animal " + "Comebacks": the accent is drawn in red.
export const RankingTitle = Schema.Struct({ lead: Schema.String, accent: Schema.String })
export type RankingTitle = typeof RankingTitle.Type

export const RankingEntry = Schema.Struct({
  // 1 = the best, played last
  rank: Schema.Int,
  // which of the short's videos (V1 = 0); absent = V1
  source: Schema.optionalKey(SourceIndex),
  // its line on the list, about 20 characters ("Horse who gave up")
  label: Schema.String,
  emoji: Schema.String,
  shots: Schema.Array(RankingShot)
})
export type RankingEntry = typeof RankingEntry.Type

// A ranking as it's edited and checked: the title, the entries and the order they play in (ranks, #1 last).
export const RankingProposal = Schema.Struct({
  title: RankingTitle,
  entries: Schema.Array(RankingEntry),
  order: Schema.Array(Schema.Int)
})
export type RankingProposal = typeof RankingProposal.Type

// What the moments agent sends: each entry's video by its V number (V2 = 2), and per shot whether it looked at the
// shot's first and last frames after Viral flagged them as different. The play order is optional (Viral shuffles it,
// #1 last).
const { role, start, end, framing, cropX, note } = RankingShot.fields
export const ProposedRankingShot = Schema.Struct({
  role,
  start,
  end,
  framing,
  cropX,
  note,
  // true once you've Read this shot's first and last frames and both show the entry's animal in this role's state
  framesChecked: Schema.optionalKey(Schema.Boolean)
})
export type ProposedRankingShot = typeof ProposedRankingShot.Type
export const ProposedRankingEntry = Schema.Struct({
  rank: Schema.Int,
  video: Schema.optionalKey(VideoNumber),
  label: Schema.String,
  emoji: Schema.String,
  shots: Schema.Array(ProposedRankingShot)
})
export type ProposedRankingEntry = typeof ProposedRankingEntry.Type
export const ProposedRanking = Schema.Struct({
  title: RankingTitle,
  entries: Schema.Array(ProposedRankingEntry),
  order: Schema.optionalKey(Schema.Array(Schema.Int))
})
export type ProposedRanking = typeof ProposedRanking.Type

// A shot of the approved plan: snapped to whole sentences, with the framing settled, the words it says, and its
// first and last frames (jpgs next to the plan; null when they couldn't be drawn).
export const RankingPlanShot = Schema.Struct({
  ...RankingShot.fields,
  framing: RankingFraming,
  text: Schema.String,
  firstFrame: Schema.NullOr(Schema.String),
  lastFrame: Schema.NullOr(Schema.String)
})
export type RankingPlanShot = typeof RankingPlanShot.Type

// The approved moments: the ranking ready to assemble.
export const RankingPlan = Schema.Struct({
  title: RankingTitle,
  entries: Schema.Array(Schema.Struct({ ...RankingEntry.fields, shots: Schema.Array(RankingPlanShot) })),
  order: Schema.Array(Schema.Int),
  // the whole short once snapped, and the longest it may be (the length you chose)
  durationS: Schema.Finite,
  maxSeconds: Schema.Finite,
  // every shot's first and last frame stitched in playing order
  storyboard: Schema.NullOr(Schema.String),
  // what the checks flagged for your eye (a shot whose first and last frames look different)
  warnings: Schema.Array(Schema.String)
})
export type RankingPlan = typeof RankingPlan.Type

// Mirrors the plan render-ranking.py reads (snake_case: it's the Python renderer's file format).
export const RankingRenderPlan = Schema.Struct({
  slug: Schema.String,
  // [lead, accent]: "Ranking Animal ", "Comebacks"
  title: Schema.Tuple([Schema.String, Schema.String]),
  // ranks in playing order, #1 last
  order: Schema.Array(Schema.Int),
  // the short's videos, V1 first, each with its transcript (for the srt)
  videos: Schema.Array(Schema.Struct({ path: Schema.String, transcript: Schema.optionalKey(Schema.String) })),
  items: Schema.Array(Schema.Struct({
    rank: Schema.Int,
    label: Schema.String,
    emoji: Schema.String,
    // drawn as "via <channel>" under the clip when `via` is on
    channel: Schema.optionalKey(Schema.String),
    shots: Schema.Array(Schema.Struct({
      // index into `videos`
      source: Schema.Int,
      src: Schema.Finite,
      dur: Schema.Finite,
      framing: RankingFraming,
      crop_x: Schema.optionalKey(Schema.Finite)
    }))
  })),
  // each video's sponsor/ad/end-screen ranges by its index as a string ("0" = V1); the renderer fails on a shot in one
  exclude_by_source: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite])))),
  // [width, height]; 1080×1920 when absent
  canvas: Schema.optionalKey(Schema.Tuple([Schema.Int, Schema.Int])),
  // the window landscape footage plays in (4:3)
  landscape_aspect: Schema.optionalKey(Schema.Finite),
  // a small "via <channel>" line under each clip (off by default)
  via: Schema.optionalKey(Schema.Boolean),
  lufs: Schema.optionalKey(Schema.Finite)
})
export type RankingRenderPlan = typeof RankingRenderPlan.Type

// The checks render-ranking.py runs on the finished mp4: black stretches, each shot's first and last frame (jpgs
// next to the mp4), and the measured loudness.
export const RenderChecks = Schema.Struct({
  black: Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite])),
  lufs: Schema.NullOr(Schema.Finite),
  frames: Schema.Array(Schema.Struct({
    rank: Schema.Int,
    shot: Schema.Int,
    start: Schema.Finite,
    end: Schema.Finite,
    first: Schema.String,
    last: Schema.String
  }))
})
export type RenderChecks = typeof RenderChecks.Type
