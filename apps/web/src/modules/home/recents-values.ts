import type { ProjectFormat, Run, RunId, StageName } from "@viral/contracts"
import { plural } from "../../lib/format.ts"
import { videoNames } from "../sets/set-values.ts"
import { latestAttempts, type RunProgress } from "../videos/run-progress.ts"
import { STEP_NAMES } from "../waiting/waiting.ts"
import type { Overview } from "./overview.ts"
import type { Tone } from "./home-values.ts"

// What a row on Home's recents is doing, from the overview (a running row's % comes live, see `liveStage`).
export type RecentStatus =
  | { readonly _tag: "Waiting"; readonly stage: StageName }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Reading" }
  | { readonly _tag: "Searching" }
  | { readonly _tag: "Suggested"; readonly count: number }
  | { readonly _tag: "Published" }
  | { readonly _tag: "Other"; readonly label: string }

export type RecentKind = "short" | "set" | "video"

// Where a row opens.
export type RecentTarget =
  | { readonly _tag: "Short"; readonly projectId: string; readonly stage: StageName | null }
  | { readonly _tag: "Set"; readonly setId: string }
  | { readonly _tag: "Video"; readonly sourceId: string }

export interface RecentRow {
  readonly key: string
  readonly kind: RecentKind
  readonly title: string
  // "Narrated · Candy + Heidi", "Video set · 5 videos · from an idea"
  readonly sub: string
  // one picture for a short or a video, one per video for a set
  readonly thumbs: ReadonlyArray<string>
  readonly status: RecentStatus
  // the latest run's start, else when it was made (ms)
  readonly at: number
  // the run to follow live while it's running
  readonly runId: RunId | null
  readonly target: RecentTarget
}

const FORMAT_NAMES: Record<ProjectFormat, string> = { narrated: "Narrated", "cut-down": "Cut-down", ranking: "Ranking" }

const active = (run: Run | null) => run !== null && (run.status === "running" || run.status === "waiting")
const at = (run: Run | null, createdAt: { readonly epochMilliseconds: number }) => run?.startedAt.epochMilliseconds ?? createdAt.epochMilliseconds

// A run's state when nothing waits and it isn't running: done, or why it stopped.
const settled = (run: Run | null): RecentStatus => {
  switch (run?.status) {
    case undefined:
      return { _tag: "Other", label: "Not started" }
    case "failed":
      return { _tag: "Other", label: "Failed" }
    case "interrupted":
      return { _tag: "Other", label: "Paused" }
    case "cancelled":
      return { _tag: "Other", label: "Stopped" }
    default:
      return { _tag: "Other", label: "Ready" }
  }
}

// Every short, video set and single video (one not in a set) as a row, newest first. A row waiting for you says at
// which step; a running one is followed live.
export const recentRows = (overview: Pick<Overview, "shorts" | "setSummaries" | "videos" | "waiting">): ReadonlyArray<RecentRow> => {
  const { shorts, setSummaries, videos, waiting } = overview
  const titleOf = new Map(videos.map((v) => [v.source.id, v.source.title]))
  const inSet = new Set(setSummaries.flatMap((s) => s.set.sourceIds))

  const shortRows = shorts.map((short): RecentRow => {
    const { project } = short
    const gate = waiting.find((w) => w.projectId === project.id)
    const run = short.latestRun
    const names = videoNames(project.sourceIds.map((id) => titleOf.get(id) ?? null))
    return {
      key: `short:${project.id}`,
      kind: "short",
      title: project.title,
      sub: [FORMAT_NAMES[project.format], names.join(" + ")].filter((p) => p !== "").join(" · "),
      thumbs: short.thumb === null ? [] : [short.thumb],
      status: gate !== undefined
        ? { _tag: "Waiting", stage: gate.request.stage }
        : active(run)
        ? { _tag: "Running" }
        : run?.status === "completed"
        ? { _tag: "Published" }
        : settled(run),
      at: at(run, project.createdAt),
      runId: run?.id ?? null,
      target: { _tag: "Short", projectId: project.id, stage: gate?.request.stage ?? null }
    }
  })

  const setRows = setSummaries.map(({ set, latestRun: run, proposals, thumbs }): RecentRow => {
    const gate = waiting.find((w) => w.setId === set.id && w.projectId === null)
    const research = set.research !== null
    const count = set.sourceIds.length > 0 ? set.sourceIds.length : set.research?.videos ?? 0
    return {
      key: `set:${set.id}`,
      kind: "set",
      title: set.title,
      sub: ["Video set", plural(count, "video"), research ? "from an idea" : null].filter((p) => p !== null).join(" · "),
      thumbs,
      status: gate !== undefined
        ? { _tag: "Waiting", stage: gate.request.stage }
        : active(run)
        ? (research && set.sourceIds.length === 0 ? { _tag: "Searching" } : { _tag: "Reading" })
        : proposals > 0
        ? { _tag: "Suggested", count: proposals }
        : settled(run),
      at: at(run, set.createdAt),
      runId: run?.id ?? null,
      target: { _tag: "Set", setId: set.id }
    }
  })

  const videoRows = videos.filter((v) => !inSet.has(v.source.id)).map((video): RecentRow => {
    const { source } = video
    const run = video.latestRun
    const gate = waiting.find((w) => w.sourceId === source.id && w.projectId === null && w.setId === null)
    return {
      key: `video:${source.id}`,
      kind: "video",
      title: source.title ?? "Untitled video",
      sub: ["Video", source.channel, video.shortCount > 0 ? plural(video.shortCount, "short") : null].filter((p) => p !== null && p !== "").join(" · "),
      thumbs: video.thumb === null ? [] : [video.thumb],
      status: gate !== undefined
        ? { _tag: "Waiting", stage: gate.request.stage }
        : active(run)
        ? { _tag: "Reading" }
        : video.proposals > 0
        ? { _tag: "Suggested", count: video.proposals }
        : settled(run),
      at: at(run, source.createdAt),
      runId: run?.id ?? null,
      target: { _tag: "Video", sourceId: source.id }
    }
  })

  return [...shortRows, ...setRows, ...videoRows].sort((a, b) => b.at - a.at)
}

// --- filters ---

export type RecentTab = "all" | "short" | "set"
export const RECENT_TABS: ReadonlyArray<{ readonly value: RecentTab; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "short", label: "Shorts" },
  { value: "set", label: "Video sets" }
]

// The "+ Status" filter; waiting is also the sidebar's "Waiting for you" (/?status=waiting).
export type StatusFilter = "waiting" | "running" | "published" | "suggested"
export const STATUS_FILTERS: ReadonlyArray<{ readonly value: StatusFilter; readonly label: string }> = [
  { value: "waiting", label: "Waiting for you" },
  { value: "running", label: "In progress" },
  { value: "suggested", label: "Shorts suggested" },
  { value: "published", label: "Published" }
]
export const isStatusFilter = (value: unknown): value is StatusFilter => STATUS_FILTERS.some((f) => f.value === value)

const matchesStatus = (status: RecentStatus, filter: StatusFilter) => {
  switch (filter) {
    case "waiting":
      return status._tag === "Waiting"
    case "running":
      return status._tag === "Running" || status._tag === "Reading" || status._tag === "Searching"
    case "published":
      return status._tag === "Published"
    case "suggested":
      return status._tag === "Suggested"
  }
}

const inTab = (row: RecentRow, tab: RecentTab) => tab === "all" || row.kind === tab

export const filterRows = (
  rows: ReadonlyArray<RecentRow>,
  { tab, status, query }: { readonly tab: RecentTab; readonly status: StatusFilter | null; readonly query: string }
): ReadonlyArray<RecentRow> => {
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== "")
  return rows.filter((row) =>
    inTab(row, tab)
    && (status === null || matchesStatus(row.status, status))
    && words.every((w) => `${row.title} ${row.sub}`.toLowerCase().includes(w))
  )
}

// Each tab's count, under the status filter (not the search), so the tabs say what each holds.
export const tabCounts = (rows: ReadonlyArray<RecentRow>, status: StatusFilter | null): Record<RecentTab, number> => {
  const shown = status === null ? rows : rows.filter((r) => matchesStatus(r.status, status))
  return { all: shown.length, short: shown.filter((r) => r.kind === "short").length, set: shown.filter((r) => r.kind === "set").length }
}

// --- the status chip ---

// What a running run is on right now: its running stage and that stage's live %, from SubscribeRun.
export const liveStage = (progress: RunProgress): { readonly stage: StageName; readonly pct: number | null } | null => {
  const running = latestAttempts(progress.stages).filter((s) => s.status === "running").at(-1)
  if (running === undefined) return null
  return { stage: running.stage, pct: progress.live[running.stage]?.pct ?? null }
}

const stepName = (stage: StageName) => STEP_NAMES[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1)

// The chip's words and colour: "Waiting for you · Script", "Rendering · 62%", "3 shorts suggested". `compact` is
// the grid's shorter "Waiting · Script".
export const statusChip = (
  status: RecentStatus,
  live: { readonly stage: StageName; readonly pct: number | null } | null,
  compact = false
): { readonly tone: Tone; readonly label: string } => {
  switch (status._tag) {
    case "Waiting":
      return { tone: "wait", label: `${compact ? "Waiting" : "Waiting for you"} · ${stepName(status.stage)}` }
    case "Running": {
      if (live === null) return { tone: "run", label: "Working" }
      const pct = live.pct === null ? "" : ` · ${Math.round(live.pct)}%`
      return { tone: "run", label: live.stage === "render" ? `Rendering${pct}` : `${stepName(live.stage)}${pct}` }
    }
    case "Reading":
      return { tone: "run", label: live !== null && live.pct !== null ? `Reading · ${Math.round(live.pct)}%` : "Reading" }
    case "Searching":
      return { tone: "run", label: "Searching YouTube" }
    case "Suggested":
      return { tone: "ok", label: `${plural(status.count, "short")} suggested` }
    case "Published":
      return { tone: "ok", label: "Published" }
    case "Other":
      return { tone: "neutral", label: status.label }
  }
}

