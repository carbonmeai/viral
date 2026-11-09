import {
  looksLikeRanking,
  MAX_RESEARCH_BACKUPS,
  rankingSeconds,
  type Research,
  type ResearchLength,
  type Shortlist,
  type ShortlistVideo
} from "@viral/contracts"
import { clock } from "../../lib/format.ts"

// Ideas to click on New › From an idea.
export const IDEA_EXAMPLES: ReadonlyArray<string> = [
  "Top 10 animal rescue comebacks",
  "The most dramatic bridge demolitions, ranked",
  "Heidi Klum's Halloween costumes over the years"
]

export const LENGTH_CHOICES: ReadonlyArray<{ readonly value: ResearchLength; readonly label: string }> = [
  { value: "60", label: "Up to 60s" },
  { value: "180", label: "Up to 3 min" },
  { value: "any", label: "Any" }
]

// A ranking ("top", "ranked", "best") needs about 15 s per entry, so it starts at Up to 3 min.
export const defaultLength = (idea: string): ResearchLength => looksLikeRanking(idea) ? "180" : "60"

// The line under the length choice: "10 videos as a ranking ≈ 2:40", and a warning when that won't fit.
export const estimateLine = (videos: number, length: ResearchLength) => {
  const seconds = rankingSeconds(videos)
  const base = `${videos} videos as a ranking ≈ ${clock(seconds)}`
  if (length === "60" && seconds > 60) return `${base}, so in 60s each video gets only a moment or two`
  if (length === "180" && seconds > 180) return `${base}, over the 3-minute Shorts limit`
  return base
}

// "Searching · 5 videos · up to 60s"
export const researchFacts = (research: Research) =>
  `${research.videos} videos · ${research.length === "any" ? "any length" : research.length === "60" ? "up to 60s" : "up to 3 min"}`

// "The Dodo · 3:05 · 760k views"
export const viewsLabel = (views: number | null) =>
  views === null ? null : views >= 1_000_000 ? `${(views / 1_000_000).toFixed(views >= 10_000_000 ? 0 : 1)}M views` : views >= 1000 ? `${Math.round(views / 1000)}k views` : `${views} views`

export const videoFacts = (v: ShortlistVideo, detailed: boolean) =>
  [v.channel, v.durationS === null ? null : clock(v.durationS), viewsLabel(v.views), detailed ? v.uploadDate : null]
    .filter((p) => p !== null).join(" · ")

// The agent's moment labels are sentences ("Before: skeletal, fragile, nothing on her—rescue from Thailand"); a chip
// shows only their name ("before") and rough time, with the full words kept for a hover or the expanded line.
export interface MomentChip {
  readonly tag: string
  readonly at: string | null
  readonly full: string
}
const MAX_TAG = 22
// Labels without a name ("Sterling discovered abandoned and scared") are named by their words when they read as a
// transformation's before, care or after; otherwise by their first two words.
const STEP_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["after", /\b(home|happy|happily|playing|plays|healthy|transform\w*|forever|thriv\w*|adopt\w*|confident|new life|now)\b/i],
  ["care", /\b(vet|medical|treat\w*|hospital|groom\w*|bath|shav\w*|care\w*|foster\w*|trust\w*|heal\w*|recover\w*|surgery|clinic|feed\w*|fed)\b/i],
  ["before", /\b(found|discover\w*|abandon\w*|chain\w*|stray|streets?|matted|starv\w*|emaciat\w*|skinny|malnourish\w*|neglect\w*|surrender\w*|scared|terrified|fear\w*|lifeless|euthanasia|mange)\b/i]
]
const momentTag = (label: string) => {
  const text = label.trim()
  const named = /^([^:—–(]{1,22}?)\s*(?::|—|–|\s-\s|\()/.exec(text)?.[1]?.trim()
  if (named !== undefined && named !== "") return named.toLowerCase()
  const step = STEP_WORDS.find(([, words]) => words.test(text))
  if (step !== undefined) return step[0]
  const words = text.split(/\s+/).slice(0, 2).join(" ")
  return (words.length <= MAX_TAG ? words : `${words.slice(0, MAX_TAG - 1)}…`).toLowerCase().replace(/[.,;]+$/, "")
}
export const momentChips = (v: ShortlistVideo): ReadonlyArray<MomentChip> =>
  v.moments.map((m) => ({ tag: momentTag(m.label), at: m.at === null ? null : `~${clock(m.at)}`, full: m.label.trim() }))

// --- changing the list before you approve it ---

export const removePick = (list: Shortlist, i: number): Shortlist => ({ ...list, picks: list.picks.filter((_, k) => k !== i) })
export const removeBackup = (list: Shortlist, i: number): Shortlist => ({ ...list, backups: list.backups.filter((_, k) => k !== i) })

export const movePick = (list: Shortlist, i: number, by: number): Shortlist => {
  const j = i + by
  if (j < 0 || j >= list.picks.length) return list
  const picks = [...list.picks]
  ;[picks[i], picks[j]] = [picks[j]!, picks[i]!]
  return { ...list, picks }
}

// A backup takes a pick's place; the pick it replaces leaves the list.
export const useBackup = (list: Shortlist, backup: number, pick: number): Shortlist => {
  const chosen = list.backups[backup]
  if (chosen === undefined || pick < 0 || pick >= list.picks.length) return list
  return { ...list, picks: list.picks.map((p, k) => k === pick ? chosen : p), backups: list.backups.filter((_, k) => k !== backup) }
}

// A video you looked up goes at the end of the list (or is already on it).
export const addPick = (list: Shortlist, video: ShortlistVideo): Shortlist =>
  [...list.picks, ...list.backups].some((v) => v.videoId === video.videoId) ? list : { ...list, picks: [...list.picks, video] }

export const isOnList = (list: Shortlist, videoId: string) => [...list.picks, ...list.backups].some((v) => v.videoId === videoId)

// Whether you changed the agent's list (order, removals, backups used, links added).
export const changed = (original: Shortlist, edited: Shortlist) => {
  const ids = (l: Shortlist) => `${l.picks.map((p) => p.videoId).join(",")}|${l.backups.map((p) => p.videoId).join(",")}`
  return ids(original) !== ids(edited)
}

const listText = (list: Shortlist) => list.picks.map((p, i) => `${i + 1}. ${p.videoId} "${p.title}" (${p.part})`).join("\n")

// "Ask for another" on a row: a backup takes its place when there is one (no agent needed); otherwise the agent is asked
// for a new video in that spot, told about your changes so it keeps them.
export type AskForAnother =
  | { readonly _tag: "Backup"; readonly list: Shortlist }
  | { readonly _tag: "Agent"; readonly note: string }

export const askForAnother = (original: Shortlist, edited: Shortlist, i: number): AskForAnother => {
  if (edited.backups.length > 0) return { _tag: "Backup", list: useBackup(edited, 0, i) }
  const pick = edited.picks[i]!
  const kept = changed(original, edited) ? `\n\nI changed the list to:\n${listText(edited)}\nKeep that order.` : ""
  return { _tag: "Agent", note: `Find another video for spot ${i + 1} instead of ${pick.videoId} "${pick.title}" (${pick.part}); keep the other videos where they are.${kept}` }
}

// "Ask for a new list": your words, plus your changes so far.
export const newListNote = (original: Shortlist, edited: Shortlist, words: string) =>
  `${words.trim()}${changed(original, edited) ? `\n\nMy changes so far:\n${listText(edited)}` : ""}`

export const downloadLabel = (n: number) => `Download ${n} ${n === 1 ? "video" : "videos"}`

export const BACKUPS_NOTE = `Up to ${MAX_RESEARCH_BACKUPS} spares, downloaded only if one is needed.`

export const COPYRIGHT_SHORT = "Videos found this way belong to their channels and can draw copyright claims."
export const COPYRIGHT_FULL =
  "These videos belong to their channels and can draw Content ID claims — more likely for a ranking, which plays each video's own sound. Each channel is kept for the credits."
