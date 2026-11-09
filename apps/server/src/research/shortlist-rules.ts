import {
  MAX_RESEARCH_BACKUPS,
  MAX_RESEARCH_VIDEO_SECONDS,
  MAX_SHORTLIST_VIDEOS,
  MIN_SHORTLIST_VIDEOS,
  type ProposedShortlist,
  type Shortlist,
  type ShortlistVideo,
  youTubeId,
  youTubeUrl
} from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"
import { clock, type VideoDetails, type VideoFound } from "./youtube-values.ts"

export interface ShortlistContext {
  // how many videos the list must have
  readonly count: number
  // every video the research found (searches and lookups), by YouTube id
  readonly videos: ReadonlyMap<string, VideoFound | VideoDetails>
  // ids a lookup found removed, private or blocked, with why
  readonly unavailable: ReadonlyMap<string, string>
  readonly searches: ReadonlyArray<string>
  readonly idea: string
  // replacing one spot of an approved list: the list as it was and the id being replaced; every other video keeps
  // its place
  readonly replacing: { readonly previous: Shortlist; readonly videoId: string } | null
}

const named = (v: { readonly title: string }) => `"${v.title}"`

// Checks the research agent's list against what YouTube said: every video was found and can be looked up, isn't a
// live stream, is at most 20 minutes long and is on the list once (the same video under two links counts as one);
// exactly the number of videos asked for, and at most 3 backups. When replacing one spot, the other videos stay as
// they were and the replaced one doesn't come back. The value is the shortlist with each video's details filled
// in from YouTube's answers, not the agent's memory.
export const checkShortlist = (proposed: ProposedShortlist, context: ShortlistContext): Checked<Shortlist> => {
  const problems: Array<string> = []
  const seen = new Map<string, string>()
  const previous = context.replacing?.previous ?? null
  const keep = new Map((previous?.picks ?? []).map((p) => [p.videoId, p]))

  const resolve = (pick: ProposedShortlist["picks"][number], where: string): ShortlistVideo | null => {
    const id = youTubeId(pick.video)
    if (id === null) {
      problems.push(`${where}: "${pick.video}" isn't a YouTube video id or link`)
      return null
    }
    const video = context.videos.get(id)
    const unavailable = context.unavailable.get(id)
    if (unavailable !== undefined) {
      problems.push(`${where}: ${id} can't be looked up (${unavailable}): it's removed, private or blocked; pick another`)
      return null
    }
    if (video === undefined) {
      problems.push(`${where}: ${id} wasn't in your searches or lookups; pick only videos you found with search_youtube or video_details`)
      return null
    }
    const name = named(video)
    if (seen.has(id)) problems.push(`${where}: ${name} is already on the list (${seen.get(id)}); each video goes on it once`)
    else seen.set(id, where)
    if (video.live === true) problems.push(`${where}: ${name} is a live stream; pick a recorded video`)
    if (video.durationS !== null && video.durationS > MAX_RESEARCH_VIDEO_SECONDS) {
      problems.push(`${where}: ${name} is ${clock(video.durationS)} long; pick videos up to ${MAX_RESEARCH_VIDEO_SECONDS / 60} minutes`)
    }
    if (context.replacing !== null && id === context.replacing.videoId) {
      problems.push(`${where}: ${name} is the video being replaced; pick a different one`)
    }
    const details = "description" in video ? video : null
    return {
      videoId: id,
      url: youTubeUrl(id),
      title: video.title,
      channel: video.channel,
      durationS: video.durationS,
      views: video.views,
      uploadDate: details?.uploadDate ?? null,
      thumbnail: null,
      part: pick.part.trim(),
      why: pick.why.trim(),
      moments: pick.moments,
      addedBy: "agent",
      sourceId: keep.get(id)?.sourceId ?? null
    }
  }

  const picks = proposed.picks.flatMap((p, i) => {
    const v = resolve(p, `pick ${i + 1}`)
    return v === null ? [] : [v]
  })
  const backups = proposed.backups.flatMap((p, i) => {
    const v = resolve(p, `backup ${i + 1}`)
    return v === null ? [] : [v]
  })

  if (proposed.picks.length !== context.count) {
    problems.push(`the list has ${proposed.picks.length} ${proposed.picks.length === 1 ? "video" : "videos"}; give exactly ${context.count}, plus up to ${MAX_RESEARCH_BACKUPS} backups`)
  }
  if (proposed.backups.length > MAX_RESEARCH_BACKUPS) {
    problems.push(`there are ${proposed.backups.length} backups; give at most ${MAX_RESEARCH_BACKUPS}`)
  }
  if (previous !== null && context.replacing !== null) {
    const spot = previous.picks.findIndex((p) => p.videoId === context.replacing!.videoId)
    previous.picks.forEach((p, i) => {
      if (i === spot) return
      const now = youTubeId(proposed.picks[i]?.video ?? "")
      if (now !== p.videoId) problems.push(`pick ${i + 1} must stay ${named(p)} (${p.videoId}); only pick ${spot + 1} is being replaced`)
    })
  }

  return {
    value: { idea: context.idea, summary: proposed.summary.trim(), searches: [...context.searches], picks, backups, replacing: null },
    problems
  }
}

// Checks a shortlist you changed before approving it: 2–10 videos, none twice (picks and backups together), none
// over 20 minutes, at most 3 backups.
export const checkShortlistEdit = (shortlist: Shortlist): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const n = shortlist.picks.length
  if (n < MIN_SHORTLIST_VIDEOS) problems.push(`Keep at least ${MIN_SHORTLIST_VIDEOS} videos; the list has ${n}.`)
  if (n > MAX_SHORTLIST_VIDEOS) problems.push(`A set takes up to ${MAX_SHORTLIST_VIDEOS} videos; the list has ${n}.`)
  if (shortlist.backups.length > MAX_RESEARCH_BACKUPS) problems.push(`Keep at most ${MAX_RESEARCH_BACKUPS} backups.`)
  const seen = new Set<string>()
  for (const v of [...shortlist.picks, ...shortlist.backups]) {
    const id = youTubeId(v.videoId) ?? youTubeId(v.url)
    if (id === null) {
      problems.push(`${named(v)} isn't a YouTube video.`)
      continue
    }
    if (seen.has(id)) problems.push(`${named(v)} is on the list twice.`)
    seen.add(id)
    if (v.durationS !== null && v.durationS > MAX_RESEARCH_VIDEO_SECONDS) {
      problems.push(`${named(v)} is ${clock(v.durationS)} long; videos can be up to ${MAX_RESEARCH_VIDEO_SECONDS / 60} minutes.`)
    }
  }
  return problems
}
