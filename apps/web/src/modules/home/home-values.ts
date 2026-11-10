import type { Project, Run, Source, WaitingItem } from "@viral/contracts"
import { sourceNames } from "../sets/set-values.ts"
import { STEP_NAMES } from "../waiting/waiting.ts"

export type Tone = "neutral" | "ok" | "wait" | "run"
export interface StatusView {
  readonly tone: Tone
  readonly label: string
}

// A short's state at a glance: the step waiting for you, else what its latest run did.
export const shortStatus = (latest: Run | undefined, waiting: WaitingItem | undefined): StatusView => {
  if (waiting !== undefined) return { tone: "wait", label: STEP_NAMES[waiting.request.stage] ?? waiting.request.stage }
  switch (latest?.status) {
    case undefined:
      return { tone: "neutral", label: "Not started" }
    case "completed":
      return { tone: "ok", label: "Published" }
    case "running":
    case "waiting":
      return { tone: "run", label: "Running" }
    case "failed":
      return { tone: "neutral", label: "Failed" }
    case "interrupted":
      return { tone: "neutral", label: "Paused" }
    case "cancelled":
      return { tone: "neutral", label: "Stopped" }
  }
}

// A video's state: being read, its story mapped, or just added.
export const videoStatus = (latest: Run | undefined, storyMapped: boolean): StatusView => {
  if (latest?.status === "running" || latest?.status === "waiting") return { tone: "run", label: "Processing" }
  if (storyMapped) return { tone: "ok", label: "Story mapped" }
  if (latest?.status === "failed") return { tone: "neutral", label: "Failed" }
  return { tone: "neutral", label: "Added" }
}

// The line a short's row names its videos with: the one video's title, or each of several by its short name.
export const videosOf = (project: Pick<Project, "sourceIds">, sources: ReadonlyArray<Pick<Source, "id" | "title" | "shortName">>): string | null => {
  const used = project.sourceIds.map((id) => sources.find((s) => s.id === id) ?? null)
  return used.length > 1 ? sourceNames(used).join(" · ") : used[0]?.title ?? null
}
