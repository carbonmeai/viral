import type { AdRange, AdRanges } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"

// A little margin either side, so no frame of an ad slips into a shot.
const PAD = 0.5

// Checks ad ranges against the video's length, pads them and merges overlaps (keeping the first one's kind).
export const checkAds = (proposed: AdRanges, durationS: number): Checked<AdRanges> => {
  const problems: Array<string> = []
  const valid: Array<AdRange> = []
  for (const [i, range] of proposed.ranges.entries()) {
    if (!(range.start < range.end)) problems.push(`range ${i + 1} ends before it starts (${range.start}–${range.end}s)`)
    else if (range.start >= durationS) problems.push(`range ${i + 1} starts after the video ends (${durationS.toFixed(0)}s)`)
    else valid.push({ ...range, start: Math.max(0, range.start - PAD), end: Math.min(durationS, range.end + PAD) })
  }
  const merged: Array<AdRange> = []
  for (const range of valid.toSorted((a, b) => a.start - b.start)) {
    const last = merged.at(-1)
    if (last !== undefined && range.start <= last.end) merged[merged.length - 1] = { ...last, end: Math.max(last.end, range.end) }
    else merged.push(range)
  }
  return { value: { ranges: merged }, problems }
}
