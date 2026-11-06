import type { TranscriptWord } from "@viral/contracts"

// How far the take may be sped up or slowed down before it stops sounding natural.
export const ATEMPO_RANGE: readonly [number, number] = [0.8, 1.5]

// Words per second over the spoken span, first word to last.
export const pace = (words: ReadonlyArray<TranscriptWord>): number => {
  const first = words[0]
  const last = words.at(-1)
  if (first === undefined || last === undefined || last.e <= first.s) return 0
  return words.length / (last.e - first.s)
}

// The atempo factor that brings a take from `measured` to `target` words per second, clamped to the range
// and rounded to 2 decimals the way the hand-made shorts were (Adam needed about 1.25).
export const atempoFor = (measured: number, target: number): number => {
  if (measured <= 0) return 1
  const factor = Math.min(ATEMPO_RANGE[1], Math.max(ATEMPO_RANGE[0], target / measured))
  return Math.round(factor * 100) / 100
}
