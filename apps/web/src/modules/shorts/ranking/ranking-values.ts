import type { RankingFraming, RankingPlan, RankingProposal, RankingRole } from "@viral/contracts"

// A ranking as the Ranking step edits it: the moments stage's own shape (each entry's video by position, every shot in
// its video's seconds), so an edit goes to the server exactly as it's checked.
export type RankingDraft = RankingProposal
export type DraftEntry = RankingDraft["entries"][number]
export type DraftShot = DraftEntry["shots"][number]

// The approved (or waiting) plan as an edit starts from it: its shots without their words and frames.
export const draftOf = (plan: RankingPlan): RankingDraft => ({
  title: plan.title,
  order: plan.order,
  entries: plan.entries.map((e) => ({
    rank: e.rank,
    ...(e.source === undefined ? {} : { source: e.source }),
    label: e.label,
    emoji: e.emoji,
    shots: e.shots.map((s) => ({
      role: s.role,
      start: s.start,
      end: s.end,
      framing: s.framing,
      ...(s.cropX === undefined ? {} : { cropX: s.cropX }),
      note: s.note
    }))
  }))
})

// The entries #1 first, as the inspector lists them.
export const byRank = (draft: RankingDraft): ReadonlyArray<DraftEntry> => [...draft.entries].sort((a, b) => a.rank - b.rank)

export const entrySeconds = (entry: { readonly shots: ReadonlyArray<{ readonly start: number; readonly end: number }> }) =>
  entry.shots.reduce((n, s) => n + Math.max(0, s.end - s.start), 0)
export const totalSeconds = (draft: { readonly entries: ReadonlyArray<{ readonly shots: ReadonlyArray<{ readonly start: number; readonly end: number }> }> }) =>
  draft.entries.reduce((n, e) => n + entrySeconds(e), 0)

// #1 always plays last: the order keeps everything else where it was and puts #1 at the end.
const oneLast = (order: ReadonlyArray<number>) => [...order.filter((r) => r !== 1), ...(order.includes(1) ? [1] : [])]

// Moves an entry up (toward #1, `delta` −1) or down the ranking: it swaps rank numbers with its neighbour, and each
// keeps its place in the play order (except #1, which plays last).
export const moveRank = (draft: RankingDraft, rank: number, delta: -1 | 1): RankingDraft => {
  const other = rank + delta
  if (other < 1 || other > draft.entries.length) return draft
  const swap = (r: number) => (r === rank ? other : r === other ? rank : r)
  return {
    ...draft,
    entries: draft.entries.map((e) => ({ ...e, rank: swap(e.rank) })),
    order: oneLast(draft.order.map(swap))
  }
}

// Takes an entry out: the ranks below it move up one, and the play order follows.
export const removeEntry = (draft: RankingDraft, rank: number): RankingDraft => {
  const renumber = (r: number) => (r > rank ? r - 1 : r)
  return {
    ...draft,
    entries: draft.entries.filter((e) => e.rank !== rank).map((e) => ({ ...e, rank: renumber(e.rank) })),
    order: oneLast(draft.order.filter((r) => r !== rank).map(renumber))
  }
}

export const setEntry = (draft: RankingDraft, rank: number, change: Partial<Pick<DraftEntry, "label" | "emoji">>): RankingDraft => ({
  ...draft,
  entries: draft.entries.map((e) => (e.rank === rank ? { ...e, ...change } : e))
})

export const setShot = (draft: RankingDraft, rank: number, k: number, change: Partial<DraftShot>): RankingDraft => ({
  ...draft,
  entries: draft.entries.map((e) => (e.rank === rank ? { ...e, shots: e.shots.map((s, i) => (i === k ? { ...s, ...change } : s)) } : e))
})

// A picked frame becomes the shot's new start, keeping its length; the framing is detected afresh for the new moment.
export const moveShotTo = (draft: RankingDraft, rank: number, k: number, t: number): RankingDraft => {
  const shot = draft.entries.find((e) => e.rank === rank)?.shots[k]
  if (shot === undefined) return draft
  const { framing: _framing, ...rest } = shot
  return {
    ...draft,
    entries: draft.entries.map((e) =>
      e.rank === rank ? { ...e, shots: e.shots.map((s, i) => (i === k ? { ...rest, start: t, end: t + (shot.end - shot.start) } : s)) } : e
    )
  }
}

// One edge of a shot moved a little; the server snaps it to whole sentences when it's checked.
export const nudgeShot = (draft: RankingDraft, rank: number, k: number, edge: "start" | "end", delta: number): RankingDraft => {
  const shot = draft.entries.find((e) => e.rank === rank)?.shots[k]
  if (shot === undefined) return draft
  const value = Math.max(0, Math.round((shot[edge] + delta) * 100) / 100)
  return edge === "start" && value >= shot.end || edge === "end" && value <= shot.start ? draft : setShot(draft, rank, k, { [edge]: value })
}

// ---------------------------------------------------------------- play order (the server's shuffledOrder)

const generator = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A shuffled play order with #1 last, building to it (…, 3, 2, 1 for a long list; …, 2, 1 for a medium one).
export const shuffledOrder = (ranks: ReadonlyArray<number>, seed: number): ReadonlyArray<number> => {
  const sorted = [...new Set(ranks)].sort((a, b) => a - b)
  const n = sorted.length
  const tailSize = n >= 8 ? 3 : n >= 4 ? 2 : 1
  const tail = sorted.slice(0, tailSize).reverse()
  const rest = sorted.slice(tailSize)
  const random = generator(seed)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j]!, rest[i]!]
  }
  if (rest.length > 2 && rest.every((r, i) => i === 0 || r < rest[i - 1]!)) rest.push(rest.shift()!)
  if (rest.length > 2 && rest.every((r, i) => i === 0 || r > rest[i - 1]!)) rest.push(rest.shift()!)
  return [...rest, ...tail]
}

// "Shuffle again": a new order, never the one it has now when another exists.
export const shuffleAgain = (draft: RankingDraft, seed: number): RankingDraft => {
  const ranks = draft.entries.map((e) => e.rank)
  for (let s = seed; s < seed + 20; s++) {
    const order = shuffledOrder(ranks, s)
    if (order.join(",") !== draft.order.join(",")) return { ...draft, order }
  }
  return draft
}

// Moves a rank one place earlier or later in the play order (Detailed view); #1 stays last.
export const moveInOrder = (draft: RankingDraft, rank: number, delta: -1 | 1): RankingDraft => {
  const i = draft.order.indexOf(rank)
  const j = i + delta
  if (rank === 1 || i < 0 || j < 0 || j >= draft.order.length || draft.order[j] === 1) return draft
  const order = [...draft.order]
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  return { ...draft, order }
}

// ---------------------------------------------------------------- the overlay

// The list down the left while `rank` plays: every rank's line, filled in for the entries played so far (up to and
// including this one), as the renderer draws it.
export const listWhilePlaying = (draft: RankingDraft, rank: number) => {
  const at = draft.order.indexOf(rank)
  const played = new Set(at < 0 ? [rank] : draft.order.slice(0, at + 1))
  return byRank(draft).map((e) => ({ rank: e.rank, revealed: played.has(e.rank), label: e.label, emoji: e.emoji }))
}

// The colour of a rank's number: 1 gold, 2 silver, 3 bronze, the last red, the rest white.
export const rankColor = (rank: number, count: number) =>
  rank === 1 ? "#F5C518" : rank === 2 ? "#E6E6E6" : rank === 3 ? "#E0954B" : rank === count ? "#E8202A" : "#FFFFFF"

// The same colours as ink on the app's own surfaces (light and dark): silver darkened so it reads on white, and the
// plain ranks in the text colour (undefined).
export const rankInk = (rank: number, count: number): string | undefined => {
  const colour = rankColor(rank, count)
  return colour === "#FFFFFF" ? undefined : colour === "#E6E6E6" ? "#9A9AA3" : colour
}

export const ROLE_NAMES: Record<RankingRole, string> = { before: "Before", care: "Care", after: "After" }
export const FRAMING_NAMES: Record<RankingFraming, string> = { window: "Window", fill: "Fill" }

// ---------------------------------------------------------------- changes, frames and words

const entryKey = (e: DraftEntry) => JSON.stringify([e.source ?? 0, e.label, e.emoji, e.shots.map((s) => [s.role, s.start, s.end, s.framing ?? null, s.cropX ?? null])])

// How many things differ from the plan: the title, the order, and each entry (matched by its video).
export const changeCount = (plan: RankingDraft, draft: RankingDraft) => {
  const planned = new Map(plan.entries.map((e) => [e.source ?? 0, e]))
  const entries = draft.entries.filter((e) => {
    const was = planned.get(e.source ?? 0)
    return was === undefined || was.rank !== e.rank || entryKey(was) !== entryKey(e)
  }).length + plan.entries.filter((e) => !draft.entries.some((d) => (d.source ?? 0) === (e.source ?? 0))).length
  const title = plan.title.lead !== draft.title.lead || plan.title.accent !== draft.title.accent ? 1 : 0
  const order = plan.order.join(",") !== draft.order.join(",") ? 1 : 0
  return entries + title + order
}

// A shot's frame from the plan (relative to the ranking plan's folder) while the shot is where the plan put it; null
// once it moved, so the editor fetches a still at its new start.
export const planFrame = (plan: RankingPlan, source: number, shot: { readonly start: number; readonly end: number }, end: "first" | "last") => {
  const entry = plan.entries.find((e) => (e.source ?? 0) === source)
  const found = entry?.shots.find((s) => Math.abs(s.start - shot.start) < 0.001 && Math.abs(s.end - shot.end) < 0.001)
  return (end === "first" ? found?.firstFrame : found?.lastFrame) ?? null
}

// The words a shot says, from its video's transcript.
export const wordsIn = (words: ReadonlyArray<{ readonly w: string; readonly s: number; readonly e: number }>, start: number, end: number) =>
  words.filter((w) => w.s >= start - 0.01 && w.e <= end + 0.01).map((w) => w.w).join(" ")

// A render check's frame (an absolute path next to the render) as a file the media route serves: the render video's
// folder (relative to the Viral home) + "checks/<name>".
export const checkFrameMedia = (videoMedia: string, absolute: string) => {
  const folder = videoMedia.includes("/") ? videoMedia.slice(0, videoMedia.lastIndexOf("/")) : ""
  const name = absolute.slice(absolute.lastIndexOf("/") + 1)
  return `${folder === "" ? "" : `${folder}/`}checks/${name}`
}

// "1:05.3" for a time in seconds.
export const clock = (t: number) => {
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`
}

// A warning from the checks in plain words, naming the video instead of its number: "#3 shot 3 (after, V3
// 28.2–35.6s): its first and last frames…" → "Look at #3's after (Cat video, 0:28.2): its first and last frames…".
export const plainWarning = (warning: string, nameOf: (index: number) => string, several: boolean) => {
  const m = /^#(\d+) shot \d+ \((before|care|after), (?:V(\d+) )?([\d.]+)–([\d.]+)s\):? (.*)$/.exec(warning)
  if (m === null) return warning.replace(/\bV(\d+)\b/g, (_, n: string) => nameOf(Number(n) - 1))
  const [, rank, role, video, start, , rest] = m
  const where = several && video !== undefined ? `${nameOf(Number(video) - 1)}, ` : ""
  return `Look at #${rank}'s ${role} (${where}${clock(Number(start))}): ${rest!.replace(/; check it shows the right animal throughout$/, "")}`
}

// Each entry where it plays in the short (seconds, in play order), for the timeline and the render's playhead.
export const entryBlocks = (draft: RankingDraft) => {
  const byRankMap = new Map(draft.entries.map((e) => [e.rank, e]))
  let t = 0
  return draft.order.flatMap((rank) => {
    const entry = byRankMap.get(rank)
    if (entry === undefined) return []
    const start = t
    t += entrySeconds(entry)
    return [{ rank, start, end: t, source: entry.source ?? 0, label: entry.label, emoji: entry.emoji }]
  })
}
