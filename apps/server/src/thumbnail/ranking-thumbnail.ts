import type { RankingPlan, ThumbConfig, ThumbnailProposal } from "@viral/contracts"

// A ranking's thumbnail (approach-ranking skill): "TOP 5" in big yellow letters over the subject, #1's after as the
// hero, and #1's before as a tilted inset (the face layer).

const fmt = (t: number) => t.toFixed(1)

// #1's after and before stretches: where the hero and the inset must come from.
export const rankingMoments = (plan: RankingPlan) => {
  const first = plan.entries.find((e) => e.rank === 1)
  if (first === undefined) return null
  const after = first.shots.filter((s) => s.role === "after")
  const before = first.shots.filter((s) => s.role === "before")
  return { entry: first, source: first.source ?? 0, after, before }
}

// The lines added to the thumbnail brief for a ranking.
export const rankingThumbnailBrief = (plan: RankingPlan, several: boolean) => {
  const moments = rankingMoments(plan)
  if (moments === null) return ""
  const video = several ? `V${moments.source + 1} ` : ""
  const ranges = (shots: typeof moments.after) => shots.map((s) => `${video}${fmt(s.start)}–${fmt(s.end)}s`).join(" or ")
  return [
    `This short is a ranking of ${plan.entries.length}: "${plan.title.lead}${plan.title.accent}", #1 is "${moments.entry.label}".`,
    `Use the bold layout. The hero is #1's AFTER (${ranges(moments.after)}${several ? `, video: ${moments.source + 1}` : ""}): its best second, the animal healthy and clearly the same one. ` +
    `The face layer is #1's BEFORE (${ranges(moments.before)}), cropped to the animal at its worst: it becomes a tilted inset. ` +
    `Words: "TOP ${plan.entries.length}" in yellow, then the subject in white ("ANIMAL COMEBACKS"). Make sure the after frame isn't a replay of the before.`
  ].join("\n")
}

// Problems with a ranking's thumbnail: the hero must be inside #1's after, the face inside #1's before, in #1's video.
export const checkRankingThumbnail = (proposal: ThumbnailProposal, plan: RankingPlan): ReadonlyArray<string> => {
  const moments = rankingMoments(plan)
  if (moments === null) return []
  const problems: Array<string> = []
  const inside = (src: number, shots: typeof moments.after) => shots.some((s) => src >= s.start && src <= s.end)
  if ((proposal.hero.source ?? 0) !== moments.source || !inside(proposal.hero.src, moments.after)) {
    problems.push(`the hero is #1's after: a second inside ${moments.after.map((s) => `${fmt(s.start)}–${fmt(s.end)}s`).join(" or ")} of #1's video`)
  }
  if (proposal.face === null) problems.push("a ranking's thumbnail shows #1's before as the inset (the face layer)")
  else if ((proposal.face.source ?? 0) !== moments.source || !inside(proposal.face.src, moments.before)) {
    problems.push(`the inset is #1's before: a second inside ${moments.before.map((s) => `${fmt(s.start)}–${fmt(s.end)}s`).join(" or ")} of #1's video`)
  }
  if (proposal.layout === "classic") problems.push("a ranking's thumbnail uses the bold layout")
  return problems
}

// The before inset sits tilted, like the skill's ranking thumbnail.
export const RANKING_INSET_TILT = -8
export const tiltInset = (config: ThumbConfig): ThumbConfig =>
  config.inset === undefined ? config : { ...config, inset: { ...config.inset, tilt: config.inset.tilt ?? RANKING_INSET_TILT } }
