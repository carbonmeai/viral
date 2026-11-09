// The stretches of a scanned video a short needs in full quality, and which of them the pieces already fetched cover.
// Pure, so the padding and merging are tested without yt-dlp.

export interface Range {
  readonly start: number
  readonly end: number
}

// A second either side of every clip: the renderers snap cuts to whole words and fade in and out, so a clip can reach
// a little past what its plan says.
export const PIECE_PADDING_S = 1
// Stretches closer than this are fetched as one piece: one longer download beats two requests and two files.
export const PIECE_MERGE_GAP_S = 2

const round = (t: number) => Math.round(t * 1000) / 1000

// The padded stretches to fetch, inside the video, merged where they touch or nearly do, in order.
export const wantedRanges = (
  clips: ReadonlyArray<Range>,
  durationS: number | null,
  padding = PIECE_PADDING_S,
  gap = PIECE_MERGE_GAP_S
): ReadonlyArray<Range> => {
  const padded = clips
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .map((c) => ({
      start: Math.max(0, c.start - padding),
      end: durationS === null ? c.end + padding : Math.min(durationS, c.end + padding)
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const r of padded) {
    const last = merged.at(-1)
    if (last !== undefined && r.start - last.end <= gap) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  return merged.map((r) => ({ start: round(r.start), end: round(r.end) }))
}

// A piece covers a stretch when it holds all of it (a few milliseconds of slack for rounding).
export const covers = (piece: Range, range: Range, slack = 0.01) => piece.start <= range.start + slack && piece.end >= range.end - slack

// The wanted stretches no single piece covers yet: only these are fetched.
export const uncovered = (wanted: ReadonlyArray<Range>, have: ReadonlyArray<Range>): ReadonlyArray<Range> =>
  wanted.filter((w) => !have.some((p) => covers(p, w)))

// The pieces a short's clips play from: every piece overlapping one of the wanted stretches.
export const piecesFor = <P extends Range>(wanted: ReadonlyArray<Range>, have: ReadonlyArray<P>): ReadonlyArray<P> =>
  have.filter((p) => wanted.some((w) => p.start < w.end && p.end > w.start)).toSorted((a, b) => a.start - b.start)
