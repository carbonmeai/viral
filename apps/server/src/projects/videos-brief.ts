import type { Transcript } from "@viral/contracts"
import { labelledLine } from "../set-story/transcript-tools.ts"

// How an agent brief lays out several videos (a video set's, or a short's from several videos): each one labelled
// `V2 "Title" (channel, 38:16)`, every timed line "[V2 724.3–726.1] text" in that video's own seconds, and each
// video's transcript whole when they fit together, else an outline the agent reads further with the
// `search_transcript` / `read_transcript` tools.

// Transcripts up to about this many characters in total go into a brief whole; above it, each video gets an
// outline and the agent reads the rest with the tools.
export const INLINE_BUDGET = 160_000
// An outline keeps a line about this often (seconds).
export const OUTLINE_EVERY = 30

export interface BriefVideo {
  readonly title: string | null
  readonly channel: string | null
  readonly seconds: number
  readonly transcript: Transcript | null
  // sponsor reads, ads and end screens, in the video's seconds; `kind` says which when known
  readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number; readonly kind?: string }>
}

// "38:16", "1:02:05"
export const clock = (seconds: number) => {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

// `V1 "Title" (channel, 38:16)`
export const videoLabel = (number: number, video: Pick<BriefVideo, "title" | "channel" | "seconds">) => {
  const about = [video.channel, video.seconds > 0 ? clock(video.seconds) : null].filter((p) => p !== null).join(", ")
  return `V${number} "${video.title ?? "untitled"}"${about === "" ? "" : ` (${about})`}`
}

// Every line of a video's transcript, labelled with its V number.
export const fullText = (number: number, transcript: Transcript) =>
  transcript.segments.map((s) => labelledLine(number, s)).join("\n")

// About one line every half minute, each cut to a short preview.
export const outline = (number: number, transcript: Transcript) => {
  let next = 0
  return transcript.segments.flatMap((s) => {
    if (s.start < next) return []
    next = s.start + OUTLINE_EVERY
    const text = s.text.trim()
    return [labelledLine(number, { ...s, text: text.length > 110 ? `${text.slice(0, 110)}…` : text })]
  }).join("\n")
}

// Whether the videos' transcripts fit in a brief whole.
export const fitsInline = (videos: ReadonlyArray<Pick<BriefVideo, "transcript">>, budget = INLINE_BUDGET) =>
  videos.reduce((n, v) => n + (v.transcript === null ? 0 : fullText(1, v.transcript).length), 0) <= budget

// "V2: 0–31s (sponsor), 600–640s"
const excludedText = (number: number, excluded: BriefVideo["excluded"]) =>
  `Excluded ranges in V${number} (ads, sponsor reads, end screens): ${
    excluded.map((r) => `${r.start.toFixed(0)}–${r.end.toFixed(0)}s${r.kind === undefined ? "" : ` (${r.kind})`}`).join(", ")
  }`

export interface VideoSection {
  // extra lines about this video, after its excluded ranges (its contact sheets, its story beats…)
  readonly extra?: ReadonlyArray<string>
}

// The videos list and one section per video (label, excluded ranges, extras, transcript or outline), V1 first.
export const videosSections = (
  videos: ReadonlyArray<BriefVideo & VideoSection>,
  inline = fitsInline(videos)
): { readonly list: string; readonly sections: ReadonlyArray<string>; readonly inline: boolean } => ({
  inline,
  list: videos.map((v, i) => `- ${videoLabel(i + 1, v)}`).join("\n"),
  sections: videos.map((video, i) => {
    const number = i + 1
    return [
      `## ${videoLabel(number, video)}`,
      video.excluded.length === 0 ? "" : excludedText(number, video.excluded),
      ...(video.extra ?? []),
      video.transcript === null
        ? `V${number} has no transcript.`
        : inline
        ? `Transcript of V${number}:\n${fullText(number, video.transcript)}`
        : `Outline of V${number} (a line about every ${OUTLINE_EVERY}s; read the rest with read_transcript):\n${outline(number, video.transcript)}`
    ].filter((part) => part !== "").join("\n\n")
  })
})

// The note every brief over several videos carries: how videos and times are labelled, and how a clip names its
// video.
export const VIDEOS_NOTE = `This short draws from several videos, labelled V1, V2… in the creator's order. Every timed line
is "[V2 724.3–726.1] text": the video, then seconds in that video. Times are always in that video's own seconds, and
every clip you pick names its video (\`video\`: its V number).`
