import type { CutBeat, CutPlan, CutSection, PresetConfig, SectionsProposal, TranscriptWord } from "@viral/contracts"

// A cut-down short's section as the editor holds it: the plan's fields, the words it says (from its snapped
// times) and its own frame while its start hasn't moved. `key` keeps a section's identity when you reorder.
export interface EditSection extends CutSection {
  readonly key: string
  readonly text: string
  readonly frame: string | null
}

export interface SectionsDraft {
  readonly hookText: string | null
  readonly sections: ReadonlyArray<EditSection>
}

export const BEATS: Record<CutBeat, { readonly label: string; readonly color: string }> = {
  hook: { label: "Hook", color: "var(--lemon)" },
  rising_action: { label: "Rising", color: "var(--t-shot)" },
  conflict: { label: "Conflict", color: "var(--t-real)" },
  comeback: { label: "Comeback", color: "var(--t-cap)" },
  payoff: { label: "Payoff", color: "var(--t-music)" }
}

// A little air before a section's first word and after its last, never reaching into the next word: the same
// rule the server applies when it checks and renders the sections.
const BEFORE = 0.06
const AFTER = 0.15

// Snaps a section to the nearest word boundaries (a boundary inside a word keeps that word only if it covers at
// least half of it), as section-rules.ts snapSection does on the server.
export const snapSection = (start: number, end: number, words: ReadonlyArray<TranscriptWord>, duration: number) => {
  const inside = words.filter((w) => w.e > start && w.s < end)
  let trimmed = inside
  const half = (w: TranscriptWord) => w.s + (w.e - w.s) / 2
  if (trimmed[0] !== undefined && start > half(trimmed[0]) && trimmed.length > 1) trimmed = trimmed.slice(1)
  const last = trimmed.at(-1)
  if (last !== undefined && end < half(last) && trimmed.length > 1) trimmed = trimmed.slice(0, -1)
  const first = trimmed[0]
  const final = trimmed.at(-1)
  if (first === undefined || final === undefined) return { start: Math.max(0, start), end: Math.min(duration, end), words: trimmed }
  const before = words[words.indexOf(first) - 1]
  const after = words[words.indexOf(final) + 1]
  return {
    start: Math.max(0, before?.e ?? 0, first.s - BEFORE),
    end: Math.min(duration, after?.s ?? duration, final.e + AFTER),
    words: trimmed
  }
}

const textOf = (words: ReadonlyArray<TranscriptWord>) => words.map((w) => w.w).join(" ")

// The plan's sections as an editable draft.
export const draftOf = (plan: CutPlan): SectionsDraft => ({
  hookText: plan.hookText,
  sections: plan.sections.map((s, i) => ({ ...s, key: `plan-${i}` }))
})

const round = (t: number) => Math.round(t * 1000) / 1000

// Moves one edge of a section by `delta` seconds and snaps it to whole words. A small step always reaches the
// next word (it keeps stepping until the words change, up to 3 s), so a click is never lost inside a word.
export const nudge = (
  section: EditSection,
  edge: "start" | "end",
  delta: number,
  words: ReadonlyArray<TranscriptWord>,
  duration: number
): EditSection => {
  const before = snapSection(section.start, section.end, words, duration)
  let raw = edge === "start" ? section.start : section.end
  for (let moved = 0; Math.abs(moved) <= 3; moved += delta) {
    raw += delta
    const start = edge === "start" ? raw : section.start
    const end = edge === "end" ? raw : section.end
    if (!(end > start) || start < 0 || end > duration) break
    const snapped = snapSection(start, end, words, duration)
    if (snapped.words.length > 0 && textOf(snapped.words) !== textOf(before.words)) {
      return {
        ...section,
        start: round(snapped.start),
        end: round(snapped.end),
        text: textOf(snapped.words),
        // a moved start shows a different moment; its old frame no longer fits
        frame: edge === "start" ? null : section.frame
      }
    }
  }
  return section
}

// A video's sentences, as the server finds them (transcribe/sentences.ts): a word ending in . ? ! … or followed by a
// pause over 1.5 s ends one. A "sentence" over 25 s means no punctuation there, so it's left out.
const SENTENCE_GAP = 1.5
const LONG_SENTENCE = 25
export const sentencesOf = (words: ReadonlyArray<TranscriptWord>): ReadonlyArray<{ readonly start: number; readonly end: number }> => {
  const out: Array<{ start: number; end: number }> = []
  let first: TranscriptWord | null = null
  words.forEach((word, i) => {
    first ??= word
    const next = words[i + 1]
    if (/[.?!…]$/.test(word.w) || next === undefined || next.s - word.e > SENTENCE_GAP) {
      if (word.e - first.s <= LONG_SENTENCE) out.push({ start: first.s, end: word.e })
      first = null
    }
  })
  return out
}

// Moves one edge of a section to the next whole sentence, earlier (−1) or later (+1): a start to a sentence's first word,
// an end to a sentence's last, with the same air as snapSection. Where the transcript has no sentences to go by, it
// steps a word at a time instead. Unchanged when there's nowhere to go.
export const nudgeSentence = (
  section: EditSection,
  edge: "start" | "end",
  direction: -1 | 1,
  words: ReadonlyArray<TranscriptWord>,
  duration: number
): EditSection => {
  const sentences = sentencesOf(words)
  const current = snapSection(section.start, section.end, words, duration)
  const first = current.words[0]
  const last = current.words.at(-1)
  if (sentences.length === 0 || first === undefined || last === undefined) return nudge(section, edge, direction * 0.1, words, duration)
  const target = edge === "start"
    ? (direction < 0 ? sentences.findLast((x) => x.start < first.s - 0.01) : sentences.find((x) => x.start > first.s + 0.01 && x.start < last.s))?.start
    : (direction < 0 ? sentences.findLast((x) => x.end < last.e - 0.01 && x.end > first.e) : sentences.find((x) => x.end > last.e + 0.01))?.end
  if (target === undefined) return section
  const snapped = snapSection(edge === "start" ? target : section.start, edge === "end" ? target : section.end, words, duration)
  if (snapped.words.length === 0) return section
  return {
    ...section,
    start: round(snapped.start),
    end: round(snapped.end),
    text: textOf(snapped.words),
    // a moved start shows a different moment; its old frame no longer fits
    frame: edge === "start" ? null : section.frame
  }
}

// A line of the transcript you found, as a section you can add. `source` is its video (by position) when the
// search covers several.
export interface TranscriptMatch {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly source?: number
}

const normal = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")

// The places your words are said in the long video, each widened to its whole sentence (or 14 words at most),
// in video order. Empty for fewer than two letters.
export const searchTranscript = (words: ReadonlyArray<TranscriptWord>, query: string, limit = 8): ReadonlyArray<TranscriptMatch> => {
  const wanted = query.split(/\s+/).map(normal).filter((w) => w !== "")
  if (wanted.join("").length < 2) return []
  const matches: Array<TranscriptMatch> = []
  const ends = (w: TranscriptWord) => /[.!?]["”]?$/.test(w.w)
  for (let i = 0; i < words.length && matches.length < limit; i++) {
    if (!wanted.every((q, j) => normal(words[i + j]?.w ?? "").startsWith(q))) continue
    let from = i
    while (from > 0 && i - from < 6 && !ends(words[from - 1]!)) from--
    let to = i + wanted.length - 1
    while (to < words.length - 1 && to - from < 13 && !ends(words[to]!)) to++
    matches.push({ start: words[from]!.s, end: words[to]!.e, text: textOf(words.slice(from, to + 1)) })
    i = to
  }
  return matches
}

// One of the short's videos as its sections are cut from and checked against: its words, length and excluded ranges.
export interface CutVideo {
  readonly words: ReadonlyArray<TranscriptWord>
  readonly sourceSeconds: number
  readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number }>
}

// The places your words are said in each of the short's videos, V1's first, each match marked with its video.
export const searchVideos = (videos: ReadonlyArray<CutVideo>, query: string, limit = 8): ReadonlyArray<TranscriptMatch> =>
  videos.flatMap((v, source) => searchTranscript(v.words, query, limit).map((m) => ({ ...m, source }))).slice(0, limit * Math.min(2, videos.length))

// The video a section is cut from (V1 when it doesn't say, or when the short has no such video).
export const videoOfSection = <V>(videos: ReadonlyArray<V>, section: { readonly source?: number }): V | undefined =>
  videos[section.source ?? 0] ?? videos[0]

let added = 0
// A transcript line as a new section, snapped to its words, after the selected one. `source` is its video's
// position; V1 is left out, as the plan stores it.
export const sectionFrom = (
  match: TranscriptMatch,
  beat: CutBeat,
  words: ReadonlyArray<TranscriptWord>,
  duration: number,
  source = 0
): EditSection => {
  const snapped = snapSection(match.start, match.end, words, duration)
  added += 1
  return {
    key: `added-${added}`,
    beat,
    ...(source === 0 ? {} : { source }),
    start: round(snapped.start),
    end: round(snapped.end),
    note: "added in the editor",
    text: textOf(snapped.words),
    frame: null
  }
}

export const move = <A>(list: ReadonlyArray<A>, from: number, to: number): ReadonlyArray<A> => {
  if (from === to || to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

const sameSection = (a: EditSection, b: EditSection) =>
  a.beat === b.beat && (a.source ?? 0) === (b.source ?? 0) && a.start === b.start && a.end === b.end && a.cropX === b.cropX && a.framing === b.framing

// How many things you changed: each section added, removed, edited or moved, and the hook text. Removing one
// section is one change, not a shift of every section after it; a section counts as moved when it falls out of
// the longest run that kept its original order.
export const changeCount = (original: SectionsDraft, draft: SectionsDraft) => {
  const before = new Map(original.sections.map((s, i) => [s.key, { section: s, index: i }]))
  const kept = new Set<string>()
  const order: Array<number> = []
  let n = 0
  for (const section of draft.sections) {
    const was = before.get(section.key)
    if (was === undefined) {
      n++
      continue
    }
    kept.add(section.key)
    order.push(was.index)
    if (!sameSection(was.section, section)) n++
  }
  n += original.sections.length - kept.size
  // longest increasing run of original positions (patience sorting)
  const tails: Array<number> = []
  for (const index of order) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid]! < index) lo = mid + 1
      else hi = mid
    }
    tails[lo] = index
  }
  n += order.length - tails.length
  if ((original.hookText ?? "") !== (draft.hookText ?? "")) n++
  return n
}

// The draft as the sections gate takes an edit.
export const proposalOf = (draft: SectionsDraft): SectionsProposal => ({
  hookText: draft.hookText === null || draft.hookText.trim() === "" ? null : draft.hookText.trim(),
  sections: draft.sections.map(({ beat, source, start, end, cropX, framing, note }) => ({
    beat,
    start,
    end,
    note,
    ...(source === undefined || source === 0 ? {} : { source }),
    ...(cropX === undefined ? {} : { cropX }),
    ...(framing === undefined ? {} : { framing })
  }))
})

export const lengthOf = (s: { readonly start: number; readonly end: number }) => Math.max(0, s.end - s.start)
export const totalSeconds = (sections: ReadonlyArray<{ readonly start: number; readonly end: number }>) =>
  sections.reduce((n, s) => n + lengthOf(s), 0)

// A section's framing: its own, else the style's (the band style plays the whole frame over a blurred fill).
export const framingOf = (section: CutSection, preset: PresetConfig): "crop" | "blur" =>
  section.framing ?? (preset.framing === "band" ? "blur" : "crop")

// Where each section plays in the short, in the short's seconds, and which video it's from (by position).
export interface SectionBlock {
  readonly k: number
  readonly beat: CutBeat
  readonly source: number
  readonly start: number
  readonly end: number
}

export const sectionBlocks = (sections: ReadonlyArray<EditSection>): ReadonlyArray<SectionBlock> => {
  let at = 0
  return sections.map((s, k) => {
    const block = { k, beat: s.beat, source: s.source ?? 0, start: at, end: at + lengthOf(s) }
    at = block.end
    return block
  })
}

// Where a still of a video at a whole second is kept: "1:42" = V2 at 42s.
export const stillKey = (source: number | undefined, t: number) => `${source ?? 0}:${Math.round(t)}`

// "12:34.5" for a source second.
export const clock = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, "0")}`
}
