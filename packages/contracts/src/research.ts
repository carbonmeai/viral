import { Effect, Schema } from "effect"
import { SourceId } from "./sources.ts"

// Research mode: a video set that starts from an idea instead of your videos. Viral searches YouTube, you approve a
// shortlist, and the approved videos become the set's videos.

// How many videos a research finds; 5 to start.
export const ResearchVideoCount = Schema.Literals([3, 5, 7, 10])
export type ResearchVideoCount = typeof ResearchVideoCount.Type
export const RESEARCH_VIDEO_COUNTS: ReadonlyArray<ResearchVideoCount> = ResearchVideoCount.literals
export const DEFAULT_RESEARCH_VIDEOS: ResearchVideoCount = 5

// How long the short should be: up to 60 s, up to 3 minutes (the Shorts limit), or any length.
export const ResearchLength = Schema.Literals(["60", "180", "any"])
export type ResearchLength = typeof ResearchLength.Type

// The idea, how many videos, and the length, as you chose them on New.
export const Research = Schema.Struct({
  idea: Schema.String,
  videos: ResearchVideoCount,
  length: ResearchLength
})
export type Research = typeof Research.Type

// Politeness limits per research: YouTube blocks bursts of requests, so a research searches and looks videos up
// at most this many times.
export const RESEARCH_SEARCHES = 20
export const RESEARCH_LOOKUPS = 20
// results per search (`ytsearch8:`)
export const RESEARCH_SEARCH_RESULTS = 8
// at most this many backups under the list, downloaded only when one is needed
export const MAX_RESEARCH_BACKUPS = 3
// no pick longer than 20 minutes; the agent is told to prefer under 6
export const MAX_RESEARCH_VIDEO_SECONDS = 20 * 60
export const PREFERRED_RESEARCH_VIDEO_SECONDS = 6 * 60
// you may change the list to 2–10 videos before approving
export const MIN_SHORTLIST_VIDEOS = 2
export const MAX_SHORTLIST_VIDEOS = 10

// The list ranking needs about 15 s per entry and about 25 s for #1 (before → care → after, from the skill run).
const SECONDS_PER_ENTRY = 15
const FIRST_ENTRY_SECONDS = 25
export const rankingSeconds = (videos: number) => (Math.max(videos, 1) - 1) * SECONDS_PER_ENTRY + FIRST_ENTRY_SECONDS

// Ideas that read as a ranking ("top 10…", "…, ranked", "best…") default to Up to 3 min.
export const looksLikeRanking = (idea: string) => /\b(top|ranked|ranking|rank|best|worst|greatest)\b/i.test(idea)

// A narrated ranking (the default ranking): the hook, about 22 s an entry, #1's reveal take and the closing card. The
// skill's rescues5: five entries, 2:12.
const NARRATED_HOOK_SECONDS = 5
const NARRATED_ENTRY_SECONDS = 22
const NARRATED_ENDING_SECONDS = 17
export const narratedRankingSeconds = (videos: number) => NARRATED_HOOK_SECONDS + Math.max(videos, 1) * NARRATED_ENTRY_SECONDS + NARRATED_ENDING_SECONDS

// How many videos to find for an idea: the number a ranking names ("Top 7…") when it's one of the choices, else 5 (a
// ranking's default: five entries of 20–25 s fit the 3-minute Shorts limit).
export const videosForIdea = (idea: string): ResearchVideoCount => {
  const named = /\btop\s+(\d{1,2})\b/i.exec(idea)
  const n = named === null ? null : Number(named[1])
  return RESEARCH_VIDEO_COUNTS.find((c) => c === n) ?? DEFAULT_RESEARCH_VIDEOS
}

// The skill's vetting for a ranking's videos (finding-source-videos): one subject, 1–6 minutes, over a million views,
// real interview lines in the captions; no compilations.
export const RANKING_VIDEO_SECONDS: readonly [number, number] = [60, 6 * 60]
export const RANKING_MIN_VIEWS = 1_000_000

// A moment the agent expects in a video, with a rough time: a guess until Viral reads the video.
export const ExpectedMoment = Schema.Struct({
  label: Schema.String,
  // seconds into the video, or null when it can't tell
  at: Schema.NullOr(Schema.Finite)
})
export type ExpectedMoment = typeof ExpectedMoment.Type

// One video on the shortlist: what YouTube says about it, and its part in the short.
export const ShortlistVideo = Schema.Struct({
  // the YouTube video id: the same video under two links is the same id
  videoId: Schema.String,
  url: Schema.String,
  title: Schema.String,
  channel: Schema.NullOr(Schema.String),
  durationS: Schema.NullOr(Schema.Finite),
  views: Schema.NullOr(Schema.Finite),
  // "2026-02-07", when a lookup found it
  uploadDate: Schema.NullOr(Schema.String),
  // the thumbnail saved in the set's folder, relative to the Viral home; null when it couldn't be fetched
  thumbnail: Schema.NullOr(Schema.String),
  // its part in the short ("#3: the matted dog")
  part: Schema.String,
  // why it was picked, in one sentence
  why: Schema.String,
  moments: Schema.Array(ExpectedMoment),
  // "you" for a link you added
  addedBy: Schema.Literals(["agent", "you"]),
  // the library video it became once approved
  sourceId: Schema.NullOr(SourceId).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null)))
})
export type ShortlistVideo = typeof ShortlistVideo.Type

// The shortlist artifact: the videos in order, up to 3 backups, the searches the agent ran and its one-line
// summary of how it searched. `replacing` asks the next research for a new video in one spot ("Replace this video"
// with no backup left).
export const Shortlist = Schema.Struct({
  idea: Schema.String,
  summary: Schema.String,
  searches: Schema.Array(Schema.String),
  picks: Schema.Array(ShortlistVideo),
  backups: Schema.Array(ShortlistVideo),
  replacing: Schema.NullOr(Schema.Struct({ videoId: Schema.String, reason: Schema.String })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null))
  )
})
export type Shortlist = typeof Shortlist.Type

// What the research agent proposes: each pick by its YouTube id (or link); the server fills in the title, channel,
// length and views from what the tools found, so the agent can't misremember them.
export const ProposedPick = Schema.Struct({
  video: Schema.String,
  part: Schema.String,
  why: Schema.String,
  moments: Schema.Array(ExpectedMoment)
})
export const ProposedShortlist = Schema.Struct({
  // how it searched, in one line
  summary: Schema.String,
  picks: Schema.Array(ProposedPick),
  backups: Schema.Array(ProposedPick)
})
export type ProposedShortlist = typeof ProposedShortlist.Type

// The YouTube video id in a link (watch?v=, youtu.be/, shorts/, embed/, live/), or the text itself when it already
// is one; null for anything else.
export const youTubeId = (text: string): string | null => {
  const value = text.trim()
  if (/^[\w-]{11}$/.test(value)) return value
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "")
  const id = host === "youtu.be"
    ? url.pathname.slice(1).split("/")[0]
    : host === "youtube.com" || host === "youtube-nocookie.com"
    ? url.searchParams.get("v") ?? /^\/(shorts|embed|live|v)\/([\w-]{11})/.exec(url.pathname)?.[2]
    : undefined
  return id !== undefined && id !== null && /^[\w-]{11}$/.test(id) ? id : null
}

export const youTubeUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`

// A research that can't start: an empty idea.
export class ResearchInvalid extends Schema.TaggedError<ResearchInvalid>()("ResearchInvalid", {
  message: Schema.String
}) {}

// A YouTube link that couldn't be looked up (not a YouTube link, removed, private, blocked), in plain words.
export class ResearchLookupFailed extends Schema.TaggedError<ResearchLookupFailed>()("ResearchLookupFailed", {
  message: Schema.String
}) {}
