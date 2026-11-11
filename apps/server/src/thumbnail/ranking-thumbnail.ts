import {
  rankingEntries,
  type RankingPlan,
  type Script,
  type ShotPlan,
  type ThumbConfig,
  type ThumbnailDesign,
  type ThumbnailProposal
} from "@viral/contracts"

// A ranking's thumbnail (the thumbnails skill's ranking adaptation): #1's after as the hero and #1's before beside it
// ("TOP 5"). The basic layout shows the before as a tilted inset (the face layer); an AI round gets the before as one of
// the bottom band's real images. Both rankings: the list ranking's #1 has before/after shots by role, the narrated
// ranking's #1 is read from its script and shots.

const fmt = (t: number) => t.toFixed(1)

export interface Stretch {
  readonly start: number
  readonly end: number
}

// Where #1's after and before come from, in #1's video (`source`, V1 = 0), and what the ranking is called.
export interface RankingMoments {
  readonly count: number
  readonly title: string
  readonly label: string
  readonly source: number
  readonly after: ReadonlyArray<Stretch>
  readonly before: ReadonlyArray<Stretch>
}

// A list ranking's #1: its shots by role.
export const rankingMoments = (plan: RankingPlan): RankingMoments | null => {
  const first = plan.entries.find((e) => e.rank === 1)
  if (first === undefined) return null
  const after = first.shots.filter((s) => s.role === "after")
  const before = first.shots.filter((s) => s.role === "before")
  if (after.length === 0 || before.length === 0) return null
  return { count: plan.entries.length, title: `${plan.title.lead}${plan.title.accent}`, label: first.label, source: first.source ?? 0, after, before }
}

// how long a before shot is taken to show (the shot plan anchors a shot's start only)
const BEFORE_SECONDS = 2.5

// A narrated ranking's #1: the after is its reveal take (the last real line of #1's entry, as the shots placed it);
// the before is #1's earliest footage from the same video ahead of the reveal (the b-roll shots in #1's entry, else
// its first real line). null when the script has no #1 entry with a real line, or nothing before the reveal.
export const narratedRankingMoments = (script: Script, shots: ShotPlan | null, count: number, title: string): RankingMoments | null => {
  const { entries } = rankingEntries(script.beats, count)
  const first = entries.find((e) => e.rank === 1)
  if (first === undefined) return null
  // every real line in order, with where the shots placed it (inserts, then the outro: the script's order)
  const reals = script.beats.flatMap((b, i) => b._tag === "Real" ? [{ beat: b, i }] : [])
  const clips = shots === null ? [] : [...shots.inserts, ...shots.outro]
  const placed = (k: number) => clips.length === reals.length ? clips[k]! : reals[k]!.beat
  const mine = reals.map((r, k) => ({ ...r, k })).filter((r) => r.i >= first.start && r.i < first.end)
  const reveal = mine.at(-1)
  if (reveal === undefined) return null
  const source = reveal.beat.source ?? 0
  const after = placed(reveal.k)
  // #1's b-roll: the shots after the voiceover word where the entry before it last cut to a real line
  const lastBefore = reals.map((r, k) => ({ ...r, k })).filter((r) => r.i < first.start).at(-1)
  const cutBefore = shots === null || lastBefore === undefined || clips.length !== reals.length ? undefined : shots.inserts[lastBefore.k]
  const fromWord = cutBefore?.afterWord ?? -1
  const broll = (shots?.shots ?? [])
    .filter((s) => s.word > fromWord && (s.source ?? 0) === source && s.src < after.start)
    .sort((a, b) => a.src - b.src)
    .slice(0, 2)
    .map((s) => ({ start: s.src, end: Math.min(s.src + BEFORE_SECONDS, after.start) }))
  const firstLine = placed(mine[0]!.k)
  const before = broll.length > 0 ? broll : mine[0] !== reveal && firstLine.start < after.start ? [{ start: firstLine.start, end: firstLine.end }] : []
  if (before.length === 0) return null
  const opener = script.beats[first.start]
  return {
    count: Math.max(count, ...entries.map((e) => e.rank)),
    title,
    label: opener?._tag === "Narration" ? labelOf(opener.text) : "#1",
    source,
    after: [{ start: after.start, end: after.end }],
    before
  }
}

// "Number one is Dasher, a husky who…" → "Dasher"; "#1" when nothing is left
const labelOf = (text: string) => {
  const rest = text.replace(/^[\s"“'‘(]*(?:number|#)\s*(?:\d{1,2}|one)\b[\s,.:;!?—–-]*(?:is\s+)?/i, "")
  const clause = rest.split(/[,.;:!?—–]/)[0]!.trim().split(/\s+/).filter((w) => w !== "").slice(0, 6).join(" ")
  return clause === "" ? "#1" : clause
}

const rangesOf = (shots: ReadonlyArray<Stretch>, video: string) => shots.map((s) => `${video}${fmt(s.start)}–${fmt(s.end)}s`).join(" or ")

// The lines added to the basic thumbnail's brief for a ranking.
export const rankingThumbnailBrief = (moments: RankingMoments, several: boolean) => {
  const video = several ? `V${moments.source + 1} ` : ""
  return [
    `This short is a ranking of ${moments.count}: "${moments.title}", #1 is "${moments.label}".`,
    `Use the bold layout. The hero is #1's AFTER (${rangesOf(moments.after, video)}${several ? `, video: ${moments.source + 1}` : ""}): its best second, clearly the same subject. ` +
    `The face layer is #1's BEFORE (${rangesOf(moments.before, video)}), cropped to the subject at its worst: it becomes a tilted inset. ` +
    `Words: "TOP ${moments.count}" in yellow, then the subject in white ("ANIMAL COMEBACKS"). Make sure the after frame isn't a replay of the before.`
  ].join("\n")
}

const inside = (src: number, shots: ReadonlyArray<Stretch>) => shots.some((s) => src >= s.start && src <= s.end)
const where = (shots: ReadonlyArray<Stretch>) => shots.map((s) => `${fmt(s.start)}–${fmt(s.end)}s`).join(" or ")

// Problems with a ranking's basic thumbnail: the hero inside #1's after, the face inside #1's before, in #1's video.
export const checkRankingThumbnail = (proposal: ThumbnailProposal, moments: RankingMoments): ReadonlyArray<string> => {
  const problems: Array<string> = []
  if ((proposal.hero.source ?? 0) !== moments.source || !inside(proposal.hero.src, moments.after)) {
    problems.push(`the hero is #1's after: a second inside ${where(moments.after)} of #1's video`)
  }
  if (proposal.face === null) problems.push("a ranking's thumbnail shows #1's before as the inset (the face layer)")
  else if ((proposal.face.source ?? 0) !== moments.source || !inside(proposal.face.src, moments.before)) {
    problems.push(`the inset is #1's before: a second inside ${where(moments.before)} of #1's video`)
  }
  if (proposal.layout === "classic") problems.push("a ranking's thumbnail uses the bold layout")
  return problems
}

// The lines added to an AI round's brief for a ranking: #1's after is the hero, #1's before one of the bottom band's
// real images (beside the after), "TOP 1" or "TOP N".
export const rankingDesignBrief = (moments: RankingMoments, several: boolean) => {
  const video = several ? `V${moments.source + 1} ` : ""
  return [
    `This short is a ranking of ${moments.count}: "${moments.title}", #1 is "${moments.label}".`,
    `Follow the skill's ranking adaptation: the words are "TOP 1" (or "TOP ${moments.count}"); the hero is #1's real AFTER ` +
    `(${rangesOf(moments.after, video)}), and the bottom band shows #1's real BEFORE (${rangesOf(moments.before, video)}) beside ` +
    `the after as the two "reactions"${several ? ` (video: ${moments.source + 1})` : ""}. Make sure the after frame isn't a replay of the before.`
  ].join("\n")
}

// Problems with a ranking's AI design: the hero inside #1's after, and one of the reactions inside #1's before, in #1's video.
export const checkRankingDesign = (design: ThumbnailDesign, moments: RankingMoments): ReadonlyArray<string> => {
  const problems: Array<string> = []
  if ((design.hero.source ?? 0) !== moments.source || !inside(design.hero.src, moments.after)) {
    problems.push(`the hero is #1's after: a second inside ${where(moments.after)} of #1's video`)
  }
  if (!design.reactions.some((r) => (r.source ?? 0) === moments.source && inside(r.src, moments.before))) {
    problems.push(`one of the reactions is #1's before: a second inside ${where(moments.before)} of #1's video`)
  }
  return problems
}

// The before inset sits tilted, like the skill's ranking thumbnail.
export const RANKING_INSET_TILT = -8
export const tiltInset = (config: ThumbConfig): ThumbConfig =>
  config.inset === undefined ? config : { ...config, inset: { ...config.inset, tilt: config.inset.tilt ?? RANKING_INSET_TILT } }
