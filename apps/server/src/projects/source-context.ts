import type { TranscriptWord } from "@viral/contracts"

export type Range = { readonly start: number; readonly end: number }

// One of a short's videos as the checks see it: its words, its length and its excluded ranges (ads, sponsor
// reads, end screens). The checks get one per video, in the short's order (V1 first), and check each clip
// against its own video.
export interface SourceContext {
  readonly words: ReadonlyArray<TranscriptWord>
  readonly seconds: number
  readonly excluded: ReadonlyArray<Range>
}

// "V2": how a short's video is named to agents and in problems.
export const sourceLabel = (index: number) => `V${index + 1}`

// The video a clip's `source` index points at (absent = V1), or a problem naming the clip when the short has
// no such video.
export const clipSource = <S>(
  sources: ReadonlyArray<S>,
  index: number | undefined,
  name: string
): { readonly source: S; readonly problem: null } | { readonly source: null; readonly problem: string } => {
  const source = sources[index ?? 0]
  if (source !== undefined) return { source, problem: null }
  const range = sources.length === 1 ? "V1" : `V1–${sourceLabel(sources.length - 1)}`
  return { source: null, problem: `${name}: ${sourceLabel(index ?? 0)} isn't one of this short's videos (${range})` }
}

// A clip's `source` as it's stored: left out for V1, so a single-video short's plans are written as before.
export const sourceField = (index: number | undefined): { readonly source?: number } =>
  index === undefined || index === 0 ? {} : { source: index }
