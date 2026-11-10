import type { Change, ChatCheck, ShotPlan } from "@viral/contracts"
import { capped, changed, changeOf, clock, noted, passed, plural } from "../chat/change-lines.ts"
import { MAX_SHOT_SECONDS } from "./shot-rules.ts"

type Shot = ShotPlan["shots"][number]

// Shots whose video, source time, framing or anchor word changed ("Shot 7 now Heidi 0:41"), and shots per video
// before → after when that moved. Shots are matched by position; one added or removed shows as such.
export const describeShotsChange = (before: ShotPlan, after: ShotPlan, videoName: (source: number) => string): Change | null => {
  const where = (s: Shot) => `${videoName(s.source ?? 0)} ${clock(s.src)}${s.speed !== undefined && s.speed !== 1 ? ` at ${s.speed}×` : ""}`
  const on = (s: Shot) => `on “${s.wordText}”`
  const lines = []
  const n = Math.max(before.shots.length, after.shots.length)
  let changedCount = 0
  for (let k = 0; k < n; k++) {
    const a = before.shots[k]
    const b = after.shots[k]
    if (a === undefined && b !== undefined) lines.push(changed(`Shot ${k + 1}`, null, `${where(b)} ${on(b)}`))
    else if (b === undefined && a !== undefined) lines.push(changed(`Shot ${k + 1}`, `${where(a)} ${on(a)}`, null))
    else if (a !== undefined && b !== undefined) {
      const moved = (a.source ?? 0) !== (b.source ?? 0) || Math.abs(a.src - b.src) >= 0.5 || a.speed !== b.speed
      const anchored = a.word !== b.word
      const framed = a.fit !== b.fit || a.cropX !== b.cropX
      if (!moved && !anchored && !framed) continue
      changedCount++
      lines.push(changed(
        `Shot ${k + 1}`,
        `${where(a)}${anchored ? ` ${on(a)}` : ""}${framed ? a.fit === true ? ", fitted" : ", cropped" : ""}`,
        `${where(b)}${anchored ? ` ${on(b)}` : ""}${framed ? b.fit === true ? ", fitted" : ", cropped" : ""}`
      ))
    }
  }
  const perVideo = (plan: ShotPlan) => {
    const counts = new Map<number, number>()
    for (const s of plan.shots) counts.set(s.source ?? 0, (counts.get(s.source ?? 0) ?? 0) + 1)
    return [...counts.entries()].sort((x, y) => x[0] - y[0]).map(([i, c]) => `${videoName(i)} ${c}`).join(" · ")
  }
  const stats = perVideo(before) === perVideo(after) ? [] : [noted("Shots per video", `${perVideo(before)} → ${perVideo(after)}`)]
  const first = lines[0]
  const headline = lines.length === 1 && first !== undefined && first.old !== null && first.new !== null
    ? `${first.label} now ${first.new}`
    : `Changed ${plural(lines.length, "shot")}`
  return changeOf(headline, lines.length === 0 ? stats : [...capped(lines), ...stats])
}

export const shotsChecks = (plan: ShotPlan): ReadonlyArray<ChatCheck> => [
  passed("Every shot is inside its video, outside ads and end screens"),
  passed(`No shot runs longer than ${MAX_SHOT_SECONDS}s without a cut`),
  ...(plan.inserts.length + plan.outro.length > 0 ? [passed("Each real line plays its own clip")] : []),
  ...(plan.highlights.length > 0 ? [passed("Highlighted words are words of the voiceover")] : [])
]

export const shotsSummary = (plan: ShotPlan) =>
  `The shots: ${plural(plan.shots.length, "shot")}${plan.inserts.length + plan.outro.length > 0 ? ` and ${plural(plan.inserts.length + plan.outro.length, "real line")}` : ""}.`
