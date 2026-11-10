import type { TranscriptWord } from "@viral/contracts"

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "").replace(/'/g, "")

export interface QuoteSpan {
  readonly start: number
  readonly end: number
  // the transcript's own words for the span
  readonly words: string
}

// How far from the agent's stated time we look for its quote, in seconds.
const SEARCH_WINDOW = 20
// Clips start just before the first word and end a little after the last, so nothing is clipped.
const LEAD_IN = 0.05
const TAIL = 0.15

// Finds `quote` in the transcript, word for word (case and punctuation ignored), at the occurrence closest to
// `near` within the search window, and returns its first and last word's indices. None when the words aren't there.
export const findQuote = (
  words: ReadonlyArray<TranscriptWord>,
  quote: string,
  near: number
): { readonly first: number; readonly last: number } | null => {
  const target = quote.split(/\s+/).map(norm).filter((w) => w !== "")
  if (target.length === 0) return null
  const tokens = words.map((w) => norm(w.w))
  let best: { readonly i: number; readonly distance: number } | null = null
  for (let i = 0; i + target.length <= tokens.length; i++) {
    const distance = Math.abs(words[i]!.s - near)
    if (distance > SEARCH_WINDOW || (best !== null && distance >= best.distance)) continue
    if (target.every((t, k) => tokens[i + k] === t)) best = { i, distance }
  }
  return best === null ? null : { first: best.i, last: best.i + target.length - 1 }
}

// The clip for words `first`–`last`: from just before the first to a little after the last, with their own text.
export const spanOf = (words: ReadonlyArray<TranscriptWord>, first: number, last: number): QuoteSpan => ({
  start: Math.max(0, Math.round((words[first]!.s - LEAD_IN) * 100) / 100),
  end: Math.round((words[last]!.e + TAIL) * 100) / 100,
  words: words.slice(first, last + 1).map((w) => w.w).join(" ")
})

// Finds `quote` as findQuote does and returns its exact timing. None when the words aren't there.
export const locateQuote = (
  words: ReadonlyArray<TranscriptWord>,
  quote: string,
  near: number
): QuoteSpan | null => {
  const found = findQuote(words, quote, near)
  return found === null ? null : spanOf(words, found.first, found.last)
}
