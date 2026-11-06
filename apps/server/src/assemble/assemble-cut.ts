import type { CutPlan, CutRenderPlan, PresetConfig } from "@viral/contracts"

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
  // "Video: <channel>" when the footage isn't yours, else null
  readonly credit: string | null
}

// Approach meets style for a cut-down short: the approved sections, laid out the way the preset says, as the
// cut-down renderer's plan. The preset's band layout becomes a blurred fill, its full-bleed a crop; the hook
// title card shows only for styles with a headline. Deterministic, like assembleNarrated.
export const assembleCut = (input: CutInput): CutRenderPlan => {
  const { preset, plan } = input
  const captions = preset.captions
  return {
    slug: input.slug,
    title: input.title,
    source: input.source,
    transcript: input.sourceTranscript,
    framing: preset.framing === "full" ? "crop" : "blur",
    captions: captions.enabled,
    caption_y: captions.y,
    caption_highlight: captions.highlight,
    caption_case: captions.case,
    ...(preset.headline !== null && plan.hookText !== null ? { hook_text: plan.hookText } : {}),
    ...(preset.credit && input.credit !== null ? { credit: input.credit } : {}),
    exclude: input.excluded.map((r) => [r.start, r.end] as const),
    // the sections stage already snapped them to words
    snap: false,
    sections: plan.sections.map((s) => ({
      beat: s.beat,
      start: s.start,
      end: s.end,
      ...(s.cropX === undefined ? {} : { crop_x: s.cropX }),
      ...(s.framing === undefined ? {} : { framing: s.framing })
    })),
    lufs: preset.loudnessLufs
  }
}
