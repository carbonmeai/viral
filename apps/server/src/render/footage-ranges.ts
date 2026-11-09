import type { CutRenderPlan, NarratedPlan, RankingRenderPlan } from "@viral/contracts"
import type { Range } from "../sources/piece-ranges.ts"

// The stretches of each video a render plan plays, by the video's index in the plan (V1 = 0): what a scanned video
// needs fetched in full quality before the render. The renderers may reach a little past these (word snapping,
// fades); the pieces' padding covers that, and a clip no piece covers still plays, from the scan.

type ByVideo = ReadonlyMap<number, ReadonlyArray<Range>>

const collect = (clips: ReadonlyArray<{ readonly video: number; readonly start: number; readonly end: number }>): ByVideo => {
  const out = new Map<number, Array<Range>>()
  for (const c of clips) {
    if (!(c.end > c.start)) continue
    const list = out.get(c.video) ?? []
    list.push({ start: c.start, end: c.end })
    out.set(c.video, list)
  }
  return out
}

export const rankingRanges = (plan: RankingRenderPlan): ByVideo =>
  collect(plan.items.flatMap((item) => item.shots.map((s) => ({ video: s.source, start: s.src, end: s.src + s.dur }))))

export const cutRanges = (plan: CutRenderPlan): ByVideo =>
  collect(plan.sections.map((s) => ({ video: s.source ?? 0, start: s.start, end: s.end })))

// A narrated short's b-roll runs from each shot's moment on the voiceover to the next one's (at the shot's speed);
// a shot anchored to a voiceover word starts at that word (the first shot at 0). Inserts and outro clips play their
// own stretch.
export const narratedRanges = (plan: NarratedPlan, voiceoverWords: ReadonlyArray<{ readonly s: number; readonly e: number }>): ByVideo => {
  const timeOf = (shot: NarratedPlan["shots"][number]) =>
    shot.word === undefined ? shot.at ?? 0 : shot.word === 0 ? 0 : (voiceoverWords[shot.word]?.s ?? shot.at ?? 0) + (shot.offset ?? 0)
  // without narration_end the renderer plays to the voiceover file's end, which can trail the last word a little
  const narrationEnd = plan.narration_end ?? (voiceoverWords.at(-1)?.e ?? 0) + 2
  const shots = plan.shots.map((s) => ({ shot: s, at: timeOf(s) })).sort((a, b) => a.at - b.at)
  const clips = shots.map(({ shot, at }, i) => {
    const until = i + 1 < shots.length ? shots[i + 1]!.at : Math.max(narrationEnd, at)
    return { video: shot.source ?? 0, start: shot.src, end: shot.src + (until - at) * (shot.speed ?? 1) }
  })
  const own = [...(plan.inserts ?? []), ...(plan.outro ?? [])].map((c) => ({ video: c.source ?? 0, start: c.start, end: c.end }))
  return collect([...clips, ...own])
}
