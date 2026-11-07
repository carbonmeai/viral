import { APPROACHES, type ProposedSetStory, type SetStory, type SourceIndex } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"
import { type SourceContext, sourceLabel } from "../projects/source-context.ts"
import { locateQuote } from "../transcribe/quote-match.ts"
import { PROPOSALS } from "../story/story-rules.ts"

// A short from a set uses at least this many of its videos (a set has two or more).
export const MIN_PROPOSAL_VIDEOS = 2

// The agent numbers videos V1 = 1; the set story stores positions, V1 = 0.
const toIndex = (video: number) => (video - 1) as SourceIndex

// Checks a proposed set story against the set's videos (one context each, V1 first): every beat is in a video of
// the set and inside it, its quotes are snapped to that video's own transcript and kept out of that video's ads,
// and there are three proposals with different approaches from the catalog, each using at least two videos.
export const checkSetStory = (proposed: ProposedSetStory, videos: ReadonlyArray<SourceContext>): Checked<SetStory> => {
  const problems: Array<string> = []
  const range = `V1–${sourceLabel(videos.length - 1)}`
  const known = (video: number) => video >= 1 && video <= videos.length

  const beats = proposed.beats.flatMap((beat, b) => {
    const name = `beat ${b + 1} (${beat.beat})`
    if (!known(beat.video)) {
      problems.push(`${name}: there's no V${beat.video}; the set's videos are ${range}`)
      return []
    }
    const video = videos[beat.video - 1]!
    const label = `V${beat.video}`
    if (!(beat.start < beat.end)) problems.push(`${name} ends before it starts`)
    if (video.seconds > 0 && beat.start > video.seconds + 1) {
      problems.push(`${name} starts at ${beat.start.toFixed(1)}s, after ${label} ends (${video.seconds.toFixed(0)}s)`)
    }
    const quotes = beat.quotes.flatMap((quote) => {
      const span = locateQuote(video.words, quote.text, quote.start)
      if (span === null) {
        problems.push(`${name}: "${quote.text}" isn't in ${label}'s transcript near ${quote.start.toFixed(1)}s`)
        return []
      }
      if (video.excluded.some((a) => span.start < a.end && span.end > a.start)) {
        problems.push(`${name}: "${quote.text}" is inside an ad or sponsor read in ${label}`)
      }
      return [{ text: span.words, start: span.start, end: span.end }]
    })
    return [{ source: toIndex(beat.video), beat: beat.beat, start: beat.start, end: beat.end, summary: beat.summary, quotes }]
  })
  if (proposed.beats.length === 0) problems.push("the story has no beats")

  const summaries = proposed.videos.flatMap((v) => {
    if (known(v.video)) return [{ source: toIndex(v.video), summary: v.summary }]
    problems.push(`there's no V${v.video} to summarise; the set's videos are ${range}`)
    return []
  })

  if (proposed.proposals.length !== PROPOSALS) problems.push(`there are ${proposed.proposals.length} proposals; give exactly ${PROPOSALS}`)
  const approaches = proposed.proposals.map((p) => p.approach)
  if (new Set(approaches).size !== approaches.length) problems.push("each proposal must use a different approach")
  const proposals = proposed.proposals.map((p, i) => {
    const name = `proposal ${i + 1} (${p.title})`
    if (!(p.approach in APPROACHES)) problems.push(`${name}: "${p.approach}" isn't an approach in the catalog`)
    for (const [axis, score] of Object.entries(p.scores)) {
      if (score < 0 || score > 10) problems.push(`${name}: ${axis} is ${score}; scores are 0–10`)
    }
    const unknown = p.videos.filter((v) => !known(v))
    if (unknown.length > 0) problems.push(`${name}: there's no ${unknown.map((v) => `V${v}`).join(", ")}; the set's videos are ${range}`)
    const used = [...new Set(p.videos.filter(known))].sort((a, b) => a - b)
    const needed = Math.min(MIN_PROPOSAL_VIDEOS, videos.length)
    if (used.length < needed) problems.push(`${name} uses ${used.length === 1 ? "one video" : "no videos"}; a short from this set uses at least ${needed}`)
    return { approach: p.approach, title: p.title, hook: p.hook, why: p.why, scores: p.scores, sources: used.map(toIndex) }
  })

  return { value: { summary: proposed.summary, videos: summaries, beats, proposals }, problems }
}
