import type { Change, ChatCheck, CutPlan } from "@viral/contracts"
import { capped, changed, changeOf, clock, countHeadline, noted, passed, seconds } from "../chat/change-lines.ts"
import { SECTION_LIMITS } from "./section-rules.ts"

type Section = CutPlan["sections"][number]

const length = (plan: CutPlan) => plan.sections.reduce((t, s) => t + (s.end - s.start), 0)
const BEATS: Record<Section["beat"], string> = { hook: "Hook", rising_action: "Rising", conflict: "Conflict", comeback: "Comeback", payoff: "Payoff" }

// Sections added, removed or trimmed (matched when they overlap in the same video), with their times, and the
// short's length before → after.
export const describeSectionsChange = (before: CutPlan, after: CutPlan, videoName: (source: number) => string): Change | null => {
  const span = (s: Section) => `${BEATS[s.beat]} · ${videoName(s.source ?? 0)} ${clock(s.start)}–${clock(s.end)} “${s.text}”`
  const overlaps = (a: Section, b: Section) => (a.source ?? 0) === (b.source ?? 0) && a.start < b.end && b.start < a.end
  const used = new Set<number>()
  const lines = []
  let trimmed = 0
  let added = 0
  after.sections.forEach((b, k) => {
    const i = before.sections.findIndex((a, j) => !used.has(j) && overlaps(a, b))
    if (i === -1) {
      added++
      lines.push(changed(`Section ${k + 1}`, null, span(b)))
      return
    }
    used.add(i)
    const a = before.sections[i]!
    if (Math.abs(a.start - b.start) < 0.05 && Math.abs(a.end - b.end) < 0.05 && a.beat === b.beat && i === k) return
    trimmed++
    lines.push(changed(`Section ${k + 1}`, span(a), span(b)))
  })
  const removed = before.sections.filter((_, j) => !used.has(j))
  for (const a of removed) lines.push(changed("Removed", span(a), null))
  const hook = before.hookText === after.hookText ? [] : [changed("Hook text", before.hookText, after.hookText)]
  const total = Math.abs(length(before) - length(after)) < 0.05 ? [] : [noted("Length", `${seconds(length(before))} → ${seconds(length(after))}`)]
  const all = [...hook, ...capped(lines)]
  return changeOf(
    lines.length === 0 && hook.length > 0 ? "Changed the hook text" : countHeadline("section", { changed: trimmed, added, removed: removed.length }),
    all.length === 0 ? [] : [...all, ...total]
  )
}

export const sectionsChecks = (plan: CutPlan): ReadonlyArray<ChatCheck> => [
  passed("Every section starts and ends on a whole word"),
  passed("The hook comes first"),
  passed("No sections overlap, none inside an ad or end screen"),
  passed(`${seconds(length(plan))}, inside ${SECTION_LIMITS.total[0]}–${SECTION_LIMITS.total[1]}s`),
  ...(plan.hookText === null ? [] : [passed(`Hook text under ${SECTION_LIMITS.hookWords + 1} words`)])
]

export const sectionsSummary = (plan: CutPlan) => `The sections: ${plan.sections.length}, ${seconds(length(plan))} in all.`
