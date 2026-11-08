import type { StageName, WaitingItem } from "@viral/contracts"

// The words the app uses for each step that can wait for you.
export const STEP_NAMES: Partial<Record<StageName, string>> = {
  script: "Script",
  voice: "Voice",
  shots: "Shots",
  render: "Render",
  metadata: "Publish",
  story: "Story"
}

const stepNoun = (stage: StageName) => (STEP_NAMES[stage] ?? stage).toLowerCase()

// What the row asks you to do: "Approve the shots".
export const actionLabel = (item: WaitingItem) => `Approve the ${stepNoun(item.request.stage)}`

// The row's title: the short ("02 · Every taste") or, for a video's own gate, the video.
export const waitingTitle = (item: WaitingItem) =>
  item.projectTitle === null
    ? item.sourceTitle ?? "Untitled video"
    : `${String(item.projectNumber ?? 0).padStart(2, "0")} · ${item.projectTitle}`

// The line under it: which video, and which step ("Extreme candy · Shots step"); a short from several videos
// names them all (`videos`: "Extreme candy · Heidi Klum"). The videos are left out when the list is already one
// video's.
export const waitingSub = (item: WaitingItem, showVideo: boolean, videos?: string | null) => {
  const step = `${STEP_NAMES[item.request.stage] ?? item.request.stage} step`
  return showVideo ? `${videos ?? item.sourceTitle ?? "Untitled video"} · ${step}` : step
}

// The global list, or one video's: the same items, filtered.
export const scopeWaiting = (items: ReadonlyArray<WaitingItem>, sourceId: string | null) =>
  sourceId === null ? items : items.filter((item) => item.sourceId === sourceId)

// "across 2 videos"
export const videosSpanned = (items: ReadonlyArray<WaitingItem>) => new Set(items.map((i) => i.sourceId)).size
