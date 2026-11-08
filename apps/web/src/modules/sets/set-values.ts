import type { Run, StageName, StageRun, VideoSetMember } from "@viral/contracts"
import { latestAttempts } from "../videos/run-progress.ts"

// "Video 1", "Video 2"…: a video's place spelled out, for one without a title (never "V1", which reads as a version).
export const videoLabel = (index: number) => `Video ${index + 1}`

// Words a short name leaves out: small words, and the filler video titles are full of.
const FILLER = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "with", "as", "by", "from", "into", "about",
  "vs", "is", "are", "was", "were", "be", "it", "its", "this", "that", "my", "your", "his", "her", "their", "our", "he",
  "she", "they", "we", "i", "you", "me", "him", "them", "us", "how", "why", "what", "when", "who", "which", "i'm",
  "we're", "made", "make", "makes", "making", "built", "build", "building", "tried", "try", "trying", "just", "very",
  "really", "most", "world's", "worlds", "ever", "best", "official", "video", "full", "episode", "part", "new"
])
const NAME_MAX = 18
const capitalized = (word: string) => /^\p{Lu}/u.test(word)
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

// A short name for a video, from its title: a name in it when it has one ("Heidi Klum", "Red Bull"), else its first
// two or three meaningful words ("Extreme candy"), at most ~18 characters; "Video 2" when the title gives nothing.
export const shortVideoName = (title: string | null | undefined, index: number): string => {
  const words = (title ?? "")
    .replace(/\.(mp4|mov|m4v|webm|mkv)$/i, "")
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/[_|#:]+/g, " ")
    .replace(/’/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, ""))
    .filter((w) => w.length > 0)
  if (words.length === 0) return videoLabel(index)
  const meaningful = (w: string) => !FILLER.has(w.toLowerCase())
  // a run of two or more capitalized words is a name, unless the whole title is in title case
  const titleCase = words.filter(capitalized).length / words.length > 0.6
  let picked: ReadonlyArray<string> = []
  if (!titleCase) {
    for (let i = 0; i < words.length && picked.length === 0; i++) {
      let j = i
      while (j < words.length && capitalized(words[j]!) && meaningful(words[j]!)) j++
      if (j - i >= 2) picked = words.slice(i, j)
    }
  }
  if (picked.length === 0) picked = words.filter(meaningful)
  if (picked.length === 0) return videoLabel(index)
  let name = ""
  for (const word of picked.slice(0, 3)) {
    const next = name === "" ? word : `${name} ${word}`
    if (next.length > NAME_MAX) break
    name = next
  }
  if (name === "") name = `${picked[0]!.slice(0, NAME_MAX - 1)}…`
  return capitalize(name)
}

// Every video's short name, by position; two that come out the same are spelled out ("Video 1", "Video 2") instead.
export const videoNames = (titles: ReadonlyArray<string | null | undefined>): ReadonlyArray<string> => {
  const names = titles.map((t, i) => shortVideoName(t, i))
  return names.map((name, i) => names.filter((n) => n.toLowerCase() === name.toLowerCase()).length > 1 ? videoLabel(i) : name)
}

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
