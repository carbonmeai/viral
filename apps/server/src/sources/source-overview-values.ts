import type { Project, Proposal, SourceShort, Transcript, TranscriptLine } from "@viral/contracts"

// Which proposal each short came from. A short made from a proposal keeps its approach and title; a renamed
// one is still matched by its approach when only one proposal has it. Anything else wasn't made from one.
export const matchProposals = (projects: ReadonlyArray<Project>, proposals: ReadonlyArray<Proposal>): ReadonlyArray<SourceShort> =>
  projects.map((project) => {
    const exact = proposals.findIndex((p) => p.approach === project.approach && p.title === project.title)
    if (exact >= 0) return { project, proposal: exact }
    const sameApproach = proposals.flatMap((p, i) => p.approach === project.approach ? [i] : [])
    return { project, proposal: sameApproach.length === 1 ? sameApproach[0]! : null }
  })

// The transcript as lines to read, and its word count.
export const transcriptLines = (transcript: Transcript): { readonly words: number; readonly lines: ReadonlyArray<TranscriptLine> } => ({
  words: transcript.segments.reduce((n, s) => n + s.words.length, 0),
  lines: transcript.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
})
