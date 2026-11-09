import { APPROACHES, SINGLE_VIDEO_APPROACHES, type StoryMap, type TranscriptWord } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"
import { locateQuote } from "../transcribe/quote-match.ts"

export type Range = { readonly start: number; readonly end: number }

// One proposal per approach while the catalog has three; later the three best fits.
export const PROPOSALS = 3

// Checks a story map: quotes are snapped to the transcript and kept out of ad ranges, and the proposals are
// three different approaches from the catalog with 0–10 scores.
export const checkStory = (map: StoryMap, words: ReadonlyArray<TranscriptWord>, ads: ReadonlyArray<Range>): Checked<StoryMap> => {
  const problems: Array<string> = []
  const beats = map.beats.map((beat, b) => {
    if (!(beat.start < beat.end)) problems.push(`beat ${b + 1} (${beat.beat}) ends before it starts`)
    const quotes = beat.quotes.flatMap((quote) => {
      const span = locateQuote(words, quote.text, quote.start)
      if (span === null) {
        problems.push(`beat ${b + 1}: "${quote.text}" isn't in the transcript near ${quote.start.toFixed(1)}s`)
        return []
      }
      if (ads.some((a) => span.start < a.end && span.end > a.start)) {
        problems.push(`beat ${b + 1}: "${quote.text}" is inside an ad or sponsor read`)
      }
      return [{ text: span.words, start: span.start, end: span.end }]
    })
    return { ...beat, quotes }
  })
  if (map.beats.length === 0) problems.push("the story has no beats")
  if (map.proposals.length !== PROPOSALS) problems.push(`there are ${map.proposals.length} proposals; give exactly ${PROPOSALS}`)
  const approaches = map.proposals.map((p) => p.approach)
  if (new Set(approaches).size !== approaches.length) problems.push("each proposal must use a different approach")
  for (const p of map.proposals) {
    if (!(p.approach in APPROACHES)) problems.push(`"${p.approach}" isn't an approach in the catalog`)
    else if (!SINGLE_VIDEO_APPROACHES.includes(p.approach)) problems.push(`"${p.approach}" needs several videos; propose one from the catalog`)
    for (const [axis, score] of Object.entries(p.scores)) {
      if (score < 0 || score > 10) problems.push(`${p.approach}: ${axis} is ${score}; scores are 0–10`)
    }
  }
  return { value: { ...map, beats }, problems }
}
