import type { CutPlan, CutRenderPlan, PresetConfig } from "@viral/contracts"

// How long a cut-down short's end card holds (no narrator reads it, so long enough to read the question).
export const CUT_END_CARD_SECONDS = 3

export interface CutInput {
  readonly slug: string
  readonly title: string
  // absolute paths
  readonly source: string
  readonly sourceTranscript: string
  readonly preset: PresetConfig
  readonly plan: CutPlan
  // sponsor reads, ads and end screens, in source seconds
  readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number }>
  // the short's other videos, V2 first (absolute paths and their own excluded ranges); none for a single-video short
  readonly others?: ReadonlyArray<{
    readonly source: string
    readonly sourceTranscript: string
    readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number }>
  }>
  // "Video: <channel>" (every credited channel, "Video: A · B") when the footage isn't yours, else null
  readonly credit: string | null
}

// Approach meets style for a cut-down short: the approved sections, laid out the way the preset says, as the
// cut-down renderer's plan. The preset's band layout becomes a blurred fill, its full-bleed a crop; the hook
// title card shows only for styles with a headline. Deterministic, like assembleNarrated. A short from several
// videos lists V2… as `sources` with their own excluded ranges, and each section names its video; a single-video
// plan is written exactly as before.
export const assembleCut = (input: CutInput): CutRenderPlan => {
  const { preset, plan } = input
  const captions = preset.captions
  const others = input.others ?? []
  const range = (r: { readonly start: number; readonly end: number }) => [r.start, r.end] as const
  const excludedByVideo = others.flatMap((o, i) => o.excluded.length === 0 ? [] : [[String(i + 1), o.excluded.map(range)] as const])
  return {
    slug: input.slug,
    title: input.title,
    source: input.source,
    transcript: input.sourceTranscript,
    ...(others.length === 0 ? {} : { sources: others.map((o) => ({ path: o.source, transcript: o.sourceTranscript })) }),
    framing: preset.framing === "full" ? "crop" : "blur",
    captions: captions.enabled,
    caption_y: captions.y,
    caption_highlight: captions.highlight,
    caption_case: captions.case,
    ...(preset.headline !== null && plan.hookText !== null ? { hook_text: plan.hookText } : {}),
    ...(preset.credit && input.credit !== null ? { credit: input.credit } : {}),
    exclude: input.excluded.map(range),
    ...(excludedByVideo.length === 0 ? {} : { exclude_by_source: Object.fromEntries(excludedByVideo) }),
    // the sections stage already snapped them to words
    snap: false,
    sections: plan.sections.map((s) => ({
      beat: s.beat,
      start: s.start,
      end: s.end,
      ...(s.source === undefined || s.source === 0 ? {} : { source: s.source }),
      ...(s.cropX === undefined ? {} : { crop_x: s.cropX }),
      ...(s.framing === undefined ? {} : { framing: s.framing })
    })),
    // the style's comment question: the end card alone (Decision 6: no narrator in a cut-down)
    ...(preset.commentQuestion === true && plan.question != null && plan.question.trim() !== ""
      ? { cta: { question: plan.question.trim(), seconds: CUT_END_CARD_SECONDS } }
      : {}),
    lufs: preset.loudnessLufs
  }
}
