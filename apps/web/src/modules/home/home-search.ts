import { type FormatHint, FORMAT_CARDS } from "./prompt-values.ts"
import { isStatusFilter, type StatusFilter } from "./recents-values.ts"

// Home's URL: `?status=waiting` is the sidebar's "Waiting for you" (the recents filtered), `?start=ranking` opens the
// box on that format card (the old New page's links land here).
export interface HomeSearch {
  readonly status?: StatusFilter
  readonly start?: FormatHint
}

export const validateHomeSearch = (search: Record<string, unknown>): HomeSearch => {
  const status = search["status"]
  const start = FORMAT_CARDS.find((c) => c.id === search["start"])?.id
  return { ...(isStatusFilter(status) ? { status } : {}), ...(start === undefined ? {} : { start }) }
}

// "Waiting for you" in the sidebar, and the old /waiting page.
export const WAITING_SEARCH: HomeSearch = { status: "waiting" }

// The old New page (/videos/new?kind=one|several|idea) opens Home; an idea starts on the idea card.
export const fromNewPage = (search: Record<string, unknown>): HomeSearch => search["kind"] === "idea" ? { start: "idea" } : {}
