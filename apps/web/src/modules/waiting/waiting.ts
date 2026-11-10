import type { StageName, WaitingItem } from "@viral/contracts"

// The words the app uses for each step that can wait for you.
export const STEP_NAMES: Partial<Record<StageName, string>> = {
  script: "Script",
  sections: "Sections",
  voice: "Voice",
  shots: "Shots",
  render: "Render",
  metadata: "Publish",
  thumbnail: "Thumbnail",
  story: "Story",
  research: "Shortlist",
  moments: "Ranking"
}

const stepNoun = (stage: StageName) => (STEP_NAMES[stage] ?? stage).toLowerCase()

// What the row asks you to do: "Approve the shots".
export const actionLabel = (item: WaitingItem) => `Approve the ${stepNoun(item.request.stage)}`

// Where a row opens: the short at its step, the video set (a shortlist), or the video.
export type WaitingTarget =
  | { readonly _tag: "Short"; readonly projectId: string }
  | { readonly _tag: "Set"; readonly setId: string }
  | { readonly _tag: "Video"; readonly sourceId: string }
  | null
export const waitingTarget = (item: WaitingItem): WaitingTarget =>
  item.projectId !== null
    ? { _tag: "Short", projectId: item.projectId }
    : item.setId !== null
    ? { _tag: "Set", setId: item.setId }
    : item.sourceId !== null
    ? { _tag: "Video", sourceId: item.sourceId }
    : null

// The row's title: the short ("02 · Every taste"), the video set (a research's shortlist) or, for a video's own gate,
// the video.
export const waitingTitle = (item: WaitingItem) =>
  item.projectTitle !== null
    ? `${String(item.projectNumber ?? 0).padStart(2, "0")} · ${item.projectTitle}`
    : item.setId !== null
    ? item.setTitle ?? "Video set"
    : item.sourceTitle ?? "Untitled video"

// The line under it: which video, and which step ("Extreme candy · Shots step"); a short from several videos
// names them all (`videos`: "Extreme candy · Heidi Klum"). The videos are left out when the list is already one
// video's.
export const waitingSub = (item: WaitingItem, showVideo: boolean, videos?: string | null) => {
  const step = `${STEP_NAMES[item.request.stage] ?? item.request.stage} step`
  if (item.setId !== null) return `Found from an idea · ${step}`
  return showVideo ? `${videos ?? item.sourceTitle ?? "Untitled video"} · ${step}` : step
}

// A row's picture for a gate that has no short yet: a shortlist shows its first pick's saved YouTube thumbnail
// (a path in the Viral home, served under /media).
export const waitingThumbPath = (item: WaitingItem): string | null => {
  const payload = item.request.payload
  if (payload === null || payload === undefined || payload._tag !== "ShortlistGate") return null
  return payload.shortlist.picks.find((p) => p.thumbnail !== null)?.thumbnail ?? null
}

// The global list, or one video's: the same items, filtered.
export const scopeWaiting = (items: ReadonlyArray<WaitingItem>, sourceId: string | null) =>
  sourceId === null ? items : items.filter((item) => item.sourceId === sourceId)

// "across 2 videos" (a set's shortlist has no video yet)
export const videosSpanned = (items: ReadonlyArray<WaitingItem>) => new Set(items.flatMap((i) => i.sourceId === null ? [] : [i.sourceId])).size
