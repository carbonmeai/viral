import { type Transcript, VideoNumber } from "@viral/contracts"
import { Effect, Schema } from "effect"
import { agentTool } from "../agent-session/agent-session.ts"

// One of the set's videos as the tools read it: its transcript, if it has one.
export interface ToolVideo {
  readonly transcript: Transcript | null
}

// A read covers at most this many seconds, and a search returns at most this many lines.
export const READ_SECONDS = 300
export const SEARCH_HITS = 30

const fmt = (t: number) => t.toFixed(1)

// "[V2 724.3–726.1] It worked." — a transcript line labelled with its video, in that video's seconds.
export const labelledLine = (video: number, segment: { readonly start: number; readonly end: number; readonly text: string }) =>
  `[V${video} ${fmt(segment.start)}–${fmt(segment.end)}] ${segment.text.trim()}`

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "").replace(/'/g, "")
const tokens = (text: string) => text.split(/\s+/).map(norm).filter((w) => w !== "")

// Lines matching a query across the videos, best first: the words in order (a phrase), then all of them, then
// most of them; within each, in video and time order. Words are compared without case or punctuation.
export const searchTranscripts = (videos: ReadonlyArray<ToolVideo>, query: string, only: ReadonlyArray<number> | null) => {
  const wanted = tokens(query)
  if (wanted.length === 0) return []
  const hits: Array<{ readonly rank: number; readonly line: string }> = []
  videos.forEach((video, i) => {
    const number = i + 1
    if (video.transcript === null || (only !== null && !only.includes(number))) return
    for (const segment of video.transcript.segments) {
      const words = segment.words.length > 0 ? segment.words.map((w) => norm(w.w)).filter((w) => w !== "") : tokens(segment.text)
      const phrase = words.some((_, k) => wanted.every((w, j) => words[k + j] === w))
      const found = wanted.filter((w) => words.includes(w)).length
      const rank = phrase ? 0 : found === wanted.length ? 1 : found >= Math.ceil(wanted.length * 0.6) && found >= 2 ? 2 : -1
      if (rank >= 0) hits.push({ rank, line: labelledLine(number, segment) })
    }
  })
  return hits.sort((a, b) => a.rank - b.rank).slice(0, SEARCH_HITS).map((h) => h.line)
}

// A window of one video's transcript, every line that overlaps it.
export const readTranscript = (video: ToolVideo, number: number, from: number, to: number) =>
  (video.transcript?.segments ?? []).filter((s) => s.end > from && s.start < to).map((s) => labelledLine(number, s))

const SearchRequest = Schema.Struct({
  query: Schema.String,
  // only these videos (V numbers); all of them when left out
  videos: Schema.optionalKey(Schema.Array(VideoNumber))
})
const ReadRequest = Schema.Struct({ video: VideoNumber, from: Schema.Finite, to: Schema.Finite })

// An agent's two transcript tools over several videos (a set's, or a short's): `search_transcript` finds lines across
// them, and `read_transcript` reads up to five minutes of one video. Both answer with labelled lines. `of` names
// whose videos they are in the tools' words ("set", "short").
export const transcriptTools = (videos: ReadonlyArray<ToolVideo>, of: "set" | "short" = "set") => {
  const range = `V1–V${videos.length}`
  return [
    agentTool({
      name: "search_transcript",
      description:
        `Search the ${of}'s transcripts (${range}) for a word or phrase. Returns up to ${SEARCH_HITS} matching lines as "[V2 724.3–726.1] text", phrase matches first. Pass \`videos\` to search only some.`,
      schema: SearchRequest,
      run: ({ query, videos: only }) => {
        const hits = searchTranscripts(videos, query, only ?? null)
        return Effect.succeed(hits.length === 0 ? `nothing matches "${query}"` : hits.join("\n"))
      }
    }),
    agentTool({
      name: "read_transcript",
      description:
        `Read one video's transcript between two times (seconds, at most ${READ_SECONDS}s at once). Returns its lines as "[V2 724.3–726.1] text".`,
      schema: ReadRequest,
      run: ({ video, from, to }) => {
        const target = videos[video - 1]
        if (target === undefined) return Effect.succeed(`there's no V${video}; the ${of}'s videos are ${range}`)
        if (!(to > from) || to - from > READ_SECONDS) return Effect.succeed(`ask for 1–${READ_SECONDS} seconds, from before to`)
        const lines = readTranscript(target, video, from, to)
        return Effect.succeed(lines.length === 0 ? `V${video} has no speech between ${fmt(from)} and ${fmt(to)}s` : lines.join("\n"))
      }
    })
  ]
}
