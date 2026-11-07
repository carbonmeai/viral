import type { Run, StageName, StageRun, VideoSetMember } from "@viral/contracts"
import { latestAttempts } from "../videos/run-progress.ts"

// "V1"…"V10": how a set's (or a short's) videos are named everywhere, V1 first.
export const videoLabel = (index: number) => `V${index + 1}`

// Each video's colour, by position: the timeline's hues first, so a video keeps its colour from the set page to
// the editor.
const HUES = [
  "var(--t-shot)",
  "var(--t-real)",
  "var(--t-cap)",
  "var(--t-music)",
  "#d6409f",
  "#2f9e44",
  "#c99a06",
  "#e5484d",
  "#0e9ad6",
  "#9c6644"
] as const
export const videoColor = (index: number) => HUES[((index % HUES.length) + HUES.length) % HUES.length]!

// A set video's reading steps, as the set page words them while they run.
const READING: ReadonlyArray<{ readonly stage: StageName; readonly label: string }> = [
  { stage: "source", label: "Getting the video" },
  { stage: "transcribe", label: "Transcribing" },
  { stage: "contact-sheet", label: "Looking at the video" },
  { stage: "ads", label: "Finding the ads" }
]

export type MemberState =
  | { readonly _tag: "ready" }
  | { readonly _tag: "reading"; readonly step: string; readonly done: number; readonly of: number }
  | { readonly _tag: "failed"; readonly error: string }
  | { readonly _tag: "waiting" }

const active = (run: Run | null) => run !== null && (run.status === "running" || run.status === "waiting")

// Where one of the set's videos stands: read (everything the set story needs is there), being read (which step,
// and how many of the four are done), stopped, or not started.
export const memberState = (member: Pick<VideoSetMember, "ready">, run: Run | null, stages: ReadonlyArray<StageRun>): MemberState => {
  if (member.ready && !active(run)) return { _tag: "ready" }
  if (run !== null && active(run)) {
    const latest = latestAttempts(stages)
    const done = READING.filter((r) => latest.some((s) => s.stage === r.stage && (s.status === "succeeded" || s.status === "reused"))).length
    const current = READING.find((r) => latest.some((s) => s.stage === r.stage && s.status === "running"))
    return { _tag: "reading", step: current?.label ?? READING[Math.min(done, READING.length - 1)]!.label, done, of: READING.length }
  }
  if (member.ready) return { _tag: "ready" }
  if (run !== null && (run.status === "failed" || run.status === "cancelled" || run.status === "interrupted")) {
    return { _tag: "failed", error: run.error ?? "It stopped before it finished." }
  }
  return { _tag: "waiting" }
}

// What the set page says about the set as a whole.
export type SetPhase = "reading" | "proposing" | "proposed" | "stopped" | "new"

export const setPhase = (run: Run | null, stages: ReadonlyArray<StageRun>, hasStory: boolean): SetPhase => {
  if (run !== null && active(run)) return stages.some((s) => s.stage === "set-story") ? "proposing" : "reading"
  if (hasStory) return "proposed"
  if (run !== null && run.status !== "completed") return "stopped"
  return "new"
}

// The videos a proposal uses, by position, in set order (each once).
export const proposalVideos = (sources: ReadonlyArray<number>) => [...new Set(sources)].sort((a, b) => a - b)
