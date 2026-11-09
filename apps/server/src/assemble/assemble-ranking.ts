import type { PresetConfig, RankingPlan, RankingRenderPlan } from "@viral/contracts"

export interface RankingInput {
  readonly slug: string
  readonly plan: RankingPlan
  readonly preset: PresetConfig
  // the short's videos, V1 first: absolute paths, transcripts, excluded ranges, and the channel credited for each
  // (null when it's yours or has no channel)
  readonly videos: ReadonlyArray<{
    readonly path: string
    readonly transcript: string
    readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number }>
    readonly channel: string | null
  }>
}

const round = (t: number) => Math.round(t * 1000) / 1000

// Approach meets style for a ranking: the approved moments as the ranking renderer's plan, in the style's canvas and
// loudness, with the "via <channel>" line only when the style turns it on. No music and no captions: each clip plays
// its own sound. Deterministic, like the other assemblers.
export const assembleRanking = ({ slug, plan, preset, videos }: RankingInput): RankingRenderPlan => {
  const excluded = videos.flatMap((v, i) => v.excluded.length === 0 ? [] : [[String(i), v.excluded.map((r) => [r.start, r.end] as const)] as const])
  return {
    slug,
    title: [plan.title.lead, plan.title.accent],
    order: plan.order,
    videos: videos.map((v) => ({ path: v.path, transcript: v.transcript })),
    items: plan.entries.map((entry) => {
      const channel = videos[entry.source ?? 0]?.channel ?? null
      return {
        rank: entry.rank,
        label: entry.label,
        emoji: entry.emoji,
        ...(channel === null ? {} : { channel }),
        shots: entry.shots.map((shot) => ({
          source: entry.source ?? 0,
          src: shot.start,
          dur: round(shot.end - shot.start),
          framing: shot.framing,
          ...(shot.cropX === undefined ? {} : { crop_x: shot.cropX })
        }))
      }
    }),
    ...(excluded.length === 0 ? {} : { exclude_by_source: Object.fromEntries(excluded) }),
    canvas: preset.canvas,
    via: preset.rankingVia === true,
    lufs: preset.loudnessLufs
  }
}
