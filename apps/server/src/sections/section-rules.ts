import type { CutPlan, ProposedSections, SectionsProposal, SourceIndex, TranscriptWord } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"
import { clipSource, type SourceContext, sourceField } from "../projects/source-context.ts"
import { checkClosingQuestion } from "../script/script-rules.ts"
import { LONG_SENTENCE, type Sentence, sentencesOf, snapToSentences } from "../transcribe/sentences.ts"

export type Range = { readonly start: number; readonly end: number }

// A cut-down short before its frames are drawn.
export type CutDraft = Pick<CutPlan, "hookText" | "question"> & {
  readonly sections: ReadonlyArray<Omit<CutPlan["sections"][number], "frame">>
}

export const SECTION_LIMITS = {
  // seconds per section, and for the whole short (approach-cut-down: 30–120 s, so an exchange lands whole)
  minSection: 0.8,
  total: [30, 120] as const,
  hookWords: 8,
  // how far a section's edge may stretch to keep a sentence whole (back to its start, on to its end); past that it
  // moves inward past the partial sentence (approach-cut-down: never end on a half-answer)
  maxBack: 4,
  maxForward: 8
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

// The agent's plan (each section's video by its V number) as it's checked and stored (by position; V1 left out).
export const fromProposedSections = (proposed: ProposedSections): SectionsProposal => ({
  hookText: proposed.hookText,
  ...(proposed.question === undefined ? {} : { question: proposed.question }),
  sections: proposed.sections.map(({ video, ...section }) => ({
    ...section,
    ...sourceField(video === undefined ? undefined : (video - 1) as SourceIndex)
  }))
})

const fmt = (t: number) => t.toFixed(1)
const countWords = (text: string) => text.split(/\s+/).filter((w) => /\w/.test(w)).length

// Checks a proposed cut-down short against the short's videos (V1 first), and snaps each section to whole sentences
// (then whole words, with a little air) of its own video, adding the words it says. The renderer plays the snapped
// times as they are. `closing`: the style ends with a comment question, so the plan needs the end card's `question`
// (and without it, the question is dropped).
export const checkSections = (proposal: SectionsProposal, sources: ReadonlyArray<SourceContext>, closing: boolean = false): Checked<CutDraft> => {
  const problems: Array<string> = []
  if (proposal.sections.length === 0) problems.push("there are no sections")
  if (proposal.sections[0] !== undefined && proposal.sections[0].beat !== "hook") {
    problems.push("the first section must be the hook: the creator's strongest line")
  }

  const several = sources.length > 1
  const sentenceCache = new Map<number, ReadonlyArray<Sentence>>()
  const sentences = (source: number, words: SourceContext["words"]) => {
    const known = sentenceCache.get(source)
    if (known !== undefined) return known
    // a transcript without punctuation has no sentences to go by: those stretches snap to words only
    const found = sentencesOf(words).filter((x) => x.end - x.start <= LONG_SENTENCE)
    sentenceCache.set(source, found)
    return found
  }
  const sections = proposal.sections.map(({ source, ...section }, k) => {
    const name = `section ${k + 1} (${section.beat} ${several ? `V${(source ?? 0) + 1} ` : ""}${fmt(section.start)}–${fmt(section.end)}s)`
    const video = clipSource(sources, source, name)
    if (video.problem !== null) {
      problems.push(video.problem)
      return { ...section, ...sourceField(source), text: "" }
    }
    const ctx = video.source
    if (!(section.end > section.start)) problems.push(`${name} ends before it starts`)
    if (section.start < 0 || section.end > ctx.seconds) {
      problems.push(`${name} is outside ${several ? `V${(source ?? 0) + 1}` : "the video"} (0–${fmt(ctx.seconds)}s)`)
    }
    if (section.cropX !== undefined && (section.cropX < 0 || section.cropX > 1)) problems.push(`${name}: cropX must be 0–1`)
    const whole = snapToSentences(sentences(source ?? 0, ctx.words), section.start, section.end, {
      maxBack: SECTION_LIMITS.maxBack,
      maxForward: SECTION_LIMITS.maxForward,
      limit: ctx.seconds,
      blocked: ctx.excluded,
      minStart: 0
    })
    if (whole.problem !== null) problems.push(`${name} ${whole.problem}; move it so both ends fall on whole sentences`)
    const snapped = snapSection(whole.start, whole.end, ctx.words, ctx.seconds)
    if (snapped.end - snapped.start < SECTION_LIMITS.minSection) {
      problems.push(`${name} lasts ${fmt(snapped.end - snapped.start)}s; make it at least ${SECTION_LIMITS.minSection}s`)
    }
    if (snapped.words.length === 0) problems.push(`${name} has no speech; a cut-down short is the creator's own words`)
    const ad = ctx.excluded.find((r) => snapped.start < r.end && snapped.end > r.start)
    if (ad !== undefined) problems.push(`${name} touches an excluded range${several ? ` of V${(source ?? 0) + 1}` : ""} (${fmt(ad.start)}–${fmt(ad.end)}s)`)
    return { ...section, ...sourceField(source), start: snapped.start, end: snapped.end, text: snapped.words.map((w) => w.w).join(" ") }
  })

  // the same moment twice reads as a stutter
  sections.forEach((a, i) =>
    sections.slice(i + 1).forEach((b, j) => {
      const same = (a.source ?? 0) === (b.source ?? 0)
      if (same && a.start < b.end && b.start < a.end) problems.push(`sections ${i + 1} and ${i + j + 2} overlap in ${several ? `V${(a.source ?? 0) + 1}` : "the video"}`)
    })
  )

  const total = sections.reduce((n, s) => n + Math.max(0, s.end - s.start), 0)
  const [min, max] = SECTION_LIMITS.total
  if (sections.length > 0 && (total < min || total > max)) problems.push(`the short is ${fmt(total)}s; keep it ${min}–${max}s`)

  const hookText = proposal.hookText === null || proposal.hookText.trim() === "" ? null : proposal.hookText.trim()
  if (hookText !== null && countWords(hookText) > SECTION_LIMITS.hookWords) {
    problems.push(`the hook text is ${countWords(hookText)} words; keep it to ${SECTION_LIMITS.hookWords}`)
  }
  const question = proposal.question == null || proposal.question.trim() === "" ? null : proposal.question.trim()
  if (closing && question === null) {
    problems.push("this style ends with a comment question: write `question`, one question for the comments about the viewer (\"Would you have quit?\"); the end card shows it")
  }
  if (closing && question !== null) problems.push(...checkClosingQuestion(question))
  return { value: { hookText, sections, ...(closing && question !== null ? { question } : {}) }, problems }
}
