import type { Run, StageName, StageRun, VideoSetMember } from "@viral/contracts"
import { latestAttempts } from "../videos/run-progress.ts"

export { shortVideoName, videoLabel, videoNames } from "@viral/contracts"
import { videoNames } from "@viral/contracts"

// The same, for videos as the server sends them (an unknown one is "Video n").
export const sourceNames = (sources: ReadonlyArray<{ readonly title: string | null; readonly shortName: string | null } | null | undefined>) =>
  videoNames(sources.map((s) => s?.title ?? null), sources.map((s) => s?.shortName ?? null))

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

// A video's failure in plain words. The run's error names the stage and code first ("source (blocked): YouTube
// refused…"); a refused download says only that it was blocked, the rest loses the stage and code.
export const BLOCKED_MESSAGE = "Blocked: YouTube refused the download twice. Viral doesn't work around a block."
// yt-dlp's own failures lose its "ERROR:" and "[download]" / "[youtube] <id>:" tags.
export const plainMemberError = (error: string) => {
  if (/\((blocked)\)|HTTP Error 403|403: Forbidden/i.test(error)) return BLOCKED_MESSAGE
  const download = /^source \(download\): /.test(error)
  const text = error
    .replace(/^[\w-]+ \([\w-]+\): /, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\bERROR:\s*/g, "")
    .replace(/\[(download|youtube)\]\s*(?:[\w-]{11}:\s*)?/g, "")
    .trim()
  return download ? `The download didn't finish: ${text}` : text
}

// "Replace this video" is for a video whose own reading failed (or that the story found incomplete), not one that
// was stopped because the run was cancelled.
export const failedOnItsOwn = (run: Run | null) => run !== null && run.status === "failed"

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

// The moment a proposal card shows: a beat from one of the videos it uses, a different one for each card where the
// story has enough (card i takes its (i+1)th video, wrapping, and that video's (i+1)th beat), so the three cards
// don't all show the same video's poster. Null when the story has no beat in its videos.
export const proposalMoment = (
  story: { readonly beats: ReadonlyArray<{ readonly source: number; readonly start: number }>; readonly proposals: ReadonlyArray<{ readonly sources: ReadonlyArray<number> }> },
  index: number
): { readonly source: number; readonly t: number } | null => {
  const videos = proposalVideos(story.proposals[index]?.sources ?? [])
  if (videos.length === 0) return null
  for (let k = 0; k < videos.length; k++) {
    const source = videos[(index + k) % videos.length]!
    const beats = story.beats.filter((b) => b.source === source)
    const beat = beats[index % Math.max(beats.length, 1)]
    if (beat !== undefined) return { source, t: beat.start }
  }
  return null
}

// The list with the item at `from` moved to `to` (dragging a video to another place on New › Several videos).
export const reorder = <A>(items: ReadonlyArray<A>, from: number, to: number): ReadonlyArray<A> => {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}
