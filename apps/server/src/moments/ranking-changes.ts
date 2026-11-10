import type { Change, ChangeLine, ChatCheck, RankingPlan } from "@viral/contracts"
import { RANKING_LIMITS } from "@viral/contracts"
import { capped, changed, changeOf, clock, noted, passed, seconds } from "../chat/change-lines.ts"

type Entry = RankingPlan["entries"][number]

const lengthOf = (entry: Entry) => entry.shots.reduce((t, s) => t + (s.end - s.start), 0)
const total = (plan: RankingPlan) => plan.entries.reduce((t, e) => t + lengthOf(e), 0)
// an entry is the same one across versions when it comes from the same video (one entry per video in a set), else
// when its first moment starts at the same place
const keyOf = (entry: Entry, plan: RankingPlan) => {
  const sameVideo = plan.entries.filter((e) => (e.source ?? 0) === (entry.source ?? 0)).length
  return sameVideo === 1 ? `v${entry.source ?? 0}` : `v${entry.source ?? 0}@${Math.round(entry.shots[0]?.start ?? 0)}`
}
const named = (entry: Entry) => `#${entry.rank} ${entry.label}`

// Order changes (a swap reads "Swapped #2 and #3"), title changes, moments that moved, and the total length.
export const describeRankingChange = (before: RankingPlan, after: RankingPlan): Change | null => {
  const old = new Map(before.entries.map((e) => [keyOf(e, before), e]))
  const pairs = after.entries.flatMap((b) => {
    const a = old.get(keyOf(b, after))
    return a === undefined ? [] : [{ a, b }]
  })
  const moved = pairs.filter((p) => p.a.rank !== p.b.rank).sort((x, y) => x.b.rank - y.b.rank)
  const lines: Array<ChangeLine> = []
  let headline: string | null = null
  if (moved.length === 2 && moved[0]!.a.rank === moved[1]!.b.rank && moved[1]!.a.rank === moved[0]!.b.rank) {
    const [x, y] = [moved[0]!, moved[1]!]
    headline = `Swapped #${x.b.rank} and #${y.b.rank}`
    const byRank = (plan: RankingPlan, r: number) => plan.entries.find((e) => e.rank === r)!
    lines.push(changed(
      "Order",
      `${named(byRank(before, x.b.rank))} · ${named(byRank(before, y.b.rank))}`,
      `${named(byRank(after, x.b.rank))} · ${named(byRank(after, y.b.rank))}`
    ))
  } else {
    for (const p of moved) lines.push(changed(p.b.label, `#${p.a.rank}`, `#${p.b.rank}`))
  }
  for (const { a, b } of pairs) {
    if (a.label !== b.label || a.emoji !== b.emoji) lines.push(changed(`#${b.rank} title`, `${a.label} ${a.emoji}`, `${b.label} ${b.emoji}`))
    const spans = (e: Entry) => e.shots.map((s) => `${s.role} ${clock(s.start)}–${clock(s.end)}`).join(" · ")
    if (spans(a) !== spans(b)) lines.push(changed(`#${b.rank} moments`, spans(a), spans(b)))
  }
  for (const b of after.entries.filter((e) => !old.has(keyOf(e, after)))) lines.push(changed(`#${b.rank}`, null, b.label))
  const title = (t: RankingPlan["title"]) => `${t.lead}${t.accent}`.trim()
  if (title(before.title) !== title(after.title)) lines.unshift(changed("List title", title(before.title), title(after.title)))
  if (lines.length === 0) return null
  const t = [total(before), total(after)] as const
  const note = Math.abs(t[0] - t[1]) < 0.05 ? noted("", `Still ${seconds(t[1])}`) : noted("Length", `${seconds(t[0])} → ${seconds(t[1])}`)
  return changeOf(headline ?? `Changed ${lines.length === 1 ? lines[0]!.label : `${lines.length} things`}`, [...capped(lines), note])
}

export const rankingChecks = (plan: RankingPlan): ReadonlyArray<ChatCheck> => [
  passed(`Titles under ${RANKING_LIMITS.labelChars + 1} characters, one emoji each`),
  passed("Every entry plays before → care → after"),
  passed("Every moment is inside its video, outside end screens"),
  passed(`${seconds(total(plan))} in all, under the length limit`)
]

export const rankingSummary = (plan: RankingPlan) => `The ranking: ${plan.entries.length} entries, ${seconds(total(plan))}.`
