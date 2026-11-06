import type { CutPlan, SectionsProposal, TranscriptWord } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"

export type Range = { readonly start: number; readonly end: number }

// A cut-down short before its frames are drawn.
export type CutDraft = Pick<CutPlan, "hookText"> & {
  readonly sections: ReadonlyArray<Omit<CutPlan["sections"][number], "frame">>
}

export const SECTION_LIMITS = {
  // seconds per section, and for the whole short
  minSection: 0.8,
  total: [20, 60] as const,
  hookWords: 8
}

// A little air before a section's first word and after its last, never reaching into the next word.
const BEFORE = 0.06
const AFTER = 0.15

// Snaps a section to the nearest word boundaries so it never starts or ends mid-word: a boundary inside a word
// keeps that word only if it covers at least half of it. The air around the section stops at the neighbouring
// words, so a section that starts on "it" never picks up the "get," before it.
export const snapSection = (start: number, end: number, words: ReadonlyArray<TranscriptWord>, duration: number) => {
  const inside = words.filter((w) => w.e > start && w.s < end)
  let trimmed = inside
  const half = (w: TranscriptWord) => w.s + (w.e - w.s) / 2
  if (trimmed[0] !== undefined && start > half(trimmed[0]) && trimmed.length > 1) trimmed = trimmed.slice(1)
  const last = trimmed.at(-1)
  if (last !== undefined && end < half(last) && trimmed.length > 1) trimmed = trimmed.slice(0, -1)
  const first = trimmed[0]
  const final = trimmed.at(-1)
  if (first === undefined || final === undefined) {
    return { start: Math.max(0, start), end: Math.min(duration, end), words: trimmed }
  }
  const before = words[words.indexOf(first) - 1]
  const after = words[words.indexOf(final) + 1]
  return {
    start: Math.max(0, before?.e ?? 0, first.s - BEFORE),
    end: Math.min(duration, after?.s ?? duration, final.e + AFTER),
    words: trimmed
  }
}

const fmt = (t: number) => t.toFixed(1)
const countWords = (text: string) => text.split(/\s+/).filter((w) => /\w/.test(w)).length

export interface SectionContext {
  readonly words: ReadonlyArray<TranscriptWord>
  readonly sourceSeconds: number
  readonly excluded: ReadonlyArray<Range>
}

// Checks a proposed cut-down short against the transcript and the source, and snaps each section to whole
// words, adding the words it says. The renderer plays the snapped times as they are.
export const checkSections = (proposal: SectionsProposal, ctx: SectionContext): Checked<CutDraft> => {
  const problems: Array<string> = []
  if (proposal.sections.length === 0) problems.push("there are no sections")
  if (proposal.sections[0] !== undefined && proposal.sections[0].beat !== "hook") {
    problems.push("the first section must be the hook: the creator's strongest line")
  }

  const sections = proposal.sections.map((section, k) => {
    const name = `section ${k + 1} (${section.beat} ${fmt(section.start)}–${fmt(section.end)}s)`
    if (!(section.end > section.start)) problems.push(`${name} ends before it starts`)
    if (section.start < 0 || section.end > ctx.sourceSeconds) {
      problems.push(`${name} is outside the video (0–${fmt(ctx.sourceSeconds)}s)`)
    }
    if (section.cropX !== undefined && (section.cropX < 0 || section.cropX > 1)) problems.push(`${name}: cropX must be 0–1`)
    const snapped = snapSection(section.start, section.end, ctx.words, ctx.sourceSeconds)
    if (snapped.end - snapped.start < SECTION_LIMITS.minSection) {
      problems.push(`${name} lasts ${fmt(snapped.end - snapped.start)}s; make it at least ${SECTION_LIMITS.minSection}s`)
    }
    if (snapped.words.length === 0) problems.push(`${name} has no speech; a cut-down short is the creator's own words`)
    const ad = ctx.excluded.find((r) => snapped.start < r.end && snapped.end > r.start)
    if (ad !== undefined) problems.push(`${name} touches an excluded range (${fmt(ad.start)}–${fmt(ad.end)}s)`)
    return { ...section, start: snapped.start, end: snapped.end, text: snapped.words.map((w) => w.w).join(" ") }
  })

  // the same moment twice reads as a stutter
  sections.forEach((a, i) =>
    sections.slice(i + 1).forEach((b, j) => {
      if (a.start < b.end && b.start < a.end) problems.push(`sections ${i + 1} and ${i + j + 2} overlap in the video`)
    })
  )

  const total = sections.reduce((n, s) => n + Math.max(0, s.end - s.start), 0)
  const [min, max] = SECTION_LIMITS.total
  if (sections.length > 0 && (total < min || total > max)) problems.push(`the short is ${fmt(total)}s; keep it ${min}–${max}s`)

  const hookText = proposal.hookText === null || proposal.hookText.trim() === "" ? null : proposal.hookText.trim()
  if (hookText !== null && countWords(hookText) > SECTION_LIMITS.hookWords) {
    problems.push(`the hook text is ${countWords(hookText)} words; keep it to ${SECTION_LIMITS.hookWords}`)
  }
  return { value: { hookText, sections }, problems }
}
