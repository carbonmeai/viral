import type { TranscriptWord } from "@viral/contracts"
import { shortTimeOf, skippedAt, type TimelineLayout } from "./editor-values.ts"
import { entryBlocks, type RankingDraft } from "./ranking/ranking-values.ts"
import { type EditSection, sectionBlocks } from "./sections/sections-values.ts"

// A word on the short's own clock (seconds).
export interface CaptionWord {
  readonly w: string
  readonly s: number
  readonly e: number
}

// One caption as it's shown: from `start` to `end` on the short's clock.
export interface CaptionCue {
  readonly start: number
  readonly end: number
  readonly text: string
}

export interface CaptionStyle {
  readonly mode: "word" | "chunk"
  readonly maxWords: number
  readonly case: "lower" | "upper" | "as-spoken"
}

const cased = (text: string, style: Pick<CaptionStyle, "case">) =>
  style.case === "upper" ? text.toUpperCase() : style.case === "lower" ? text.toLowerCase() : text

const seconds = (stamp: string) => {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(stamp)
  return m === null ? 0 : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(3, "0").slice(0, 3)) / 1000
}

// A render's .srt as cues, in order (a cue's lines joined by a space).
export const parseSrt = (text: string): ReadonlyArray<CaptionCue> =>
  text.replace(/\r/g, "").split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l !== "")
    const at = lines.findIndex((l) => l.includes("-->"))
    if (at < 0) return []
    const [from, to] = lines[at]!.split("-->")
    const words = lines.slice(at + 1).join(" ").trim()
    return words === "" ? [] : [{ start: seconds(from ?? ""), end: seconds(to ?? ""), text: words }]
  })

// The narrated renderer's captions (render-narrated.py): one word at a time, or chunks of up to `maxWords` that also
// end after punctuation and at a pause over 0.35s. Each stays up until the next one starts, or half a second after its
// last word when the next is further off; the last one until the end of the short (`total`).
export const narratedCues = (words: ReadonlyArray<CaptionWord>, style: CaptionStyle, total: number): ReadonlyArray<CaptionCue> => {
  const groups: Array<ReadonlyArray<CaptionWord>> = []
  if (style.mode === "word") for (const w of words) groups.push([w])
  else {
    let current: Array<CaptionWord> = []
    words.forEach((w, i) => {
      current.push(w)
      const next = words[i + 1]
      if (current.length >= Math.max(1, style.maxWords) || /[.!?,;:]$/.test(w.w) || next === undefined || next.s - w.e > 0.35) {
        groups.push(current)
        current = []
      }
    })
  }
  return groups.map((group, i) => {
    const next = groups[i + 1]?.[0]?.s ?? total
    const last = group.at(-1)!.e
    return { start: group[0]!.s, end: next - last > 0.5 ? Math.min(next, last + 0.5) : next, text: cased(group.map((w) => w.w).join(" "), style) }
  })
}

// The cut-down and ranking renderers' captions (render-short.py, render-ranking.py): up to 3 words or 16 characters,
// ending after punctuation, each from its first word to its last.
export const clipCues = (words: ReadonlyArray<CaptionWord>, style: Pick<CaptionStyle, "case">): ReadonlyArray<CaptionCue> => {
  const cues: Array<CaptionCue> = []
  let current: Array<CaptionWord> = []
  const flush = () => {
    if (current.length === 0) return
    cues.push({ start: current[0]!.s, end: current.at(-1)!.e, text: cased(current.map((w) => w.w).join(" "), style) })
    current = []
  }
  for (const w of words) {
    current.push(w)
    if (current.length >= 3 || current.map((x) => x.w).join(" ").length >= 16 || /[.,!?;:]$/.test(w.w)) flush()
  }
  flush()
  return cues
}

// The render's own captions: its .srt, which is exact. A narrated render writes one word per line, so those are
// grouped the way the style shows them; the others are already one line per caption.
export const cuesFromSrt = (srt: string, style: CaptionStyle, total: number): ReadonlyArray<CaptionCue> => {
  const cues = parseSrt(srt)
  const wordByWord = cues.length > 0 && cues.every((c) => !/\s/.test(c.text))
  return wordByWord
    ? narratedCues(cues.map((c) => ({ w: c.text, s: c.start, e: c.end })), style, total)
    : cues.map((c) => ({ ...c, text: cased(c.text, style) }))
}

// The words of a stretch of a video (from `start` to `end`, its own seconds) placed at `at` on the short's clock, as
// the renderers take them: every word inside the stretch.
export const wordsAt = (words: ReadonlyArray<TranscriptWord>, start: number, end: number, at: number): ReadonlyArray<CaptionWord> =>
  words.filter((w) => w.s >= start - 0.01 && w.e <= end + 0.01).map((w) => ({ w: w.w, s: at + w.s - start, e: at + w.e - start }))

// A line's words spread evenly over `seconds` from `at`, for a real line before the render (the editor has its quote,
// not its word timings).
export const spreadWords = (text: string, at: number, seconds: number): ReadonlyArray<CaptionWord> => {
  const words = text.split(/\s+/).filter((w) => w !== "")
  const each = words.length === 0 ? 0 : seconds / words.length
  return words.map((w, i) => ({ w, s: at + i * each, e: at + (i + 1) * each }))
}

// A narrated short's caption words on its own clock: the voiceover's words (shifted past the real lines that play
// before them, `timeOf`), then each real line's words at its place.
export const narratedWords = (
  voiceover: ReadonlyArray<TranscriptWord>,
  timeOf: (voiceoverSeconds: number) => number,
  reals: ReadonlyArray<ReadonlyArray<CaptionWord>>
): ReadonlyArray<CaptionWord> =>
  [...voiceover.map((w) => ({ w: w.w, s: timeOf(w.s), e: timeOf(w.e) })), ...reals.flat()].sort((a, b) => a.s - b.s)

// ---- Before the render: each format's captions worked out from the words ----

// A narrated short's: the voiceover's words on the short's clock and each real line's quote spread over its clip.
export const narratedShortCues = (layout: TimelineLayout, voiceover: ReadonlyArray<TranscriptWord>, style: CaptionStyle) =>
  narratedCues(
    narratedWords(
      voiceover.filter((w) => !skippedAt(layout, w.s + 0.001)),
      (t) => shortTimeOf(layout, t),
      layout.reals.map((r) => spreadWords(r.label, r.start, r.end - r.start))
    ),
    style,
    layout.total
  )

// A cut-down short's: each section's words from its video's transcript, at its place in the short.
export const sectionCues = (sections: ReadonlyArray<EditSection>, wordsOf: (video: number) => ReadonlyArray<TranscriptWord>, style: CaptionStyle) => {
  const blocks = sectionBlocks(sections)
  return clipCues(sections.flatMap((s, k) => wordsAt(wordsOf(s.source ?? 0), s.start, s.end, blocks[k]!.start)), style)
}

// A ranking's: each shot's words from its video's transcript, entries in play order.
export const rankingCues = (ranking: RankingDraft, wordsOf: (video: number) => ReadonlyArray<TranscriptWord>, style: CaptionStyle) =>
  clipCues(entryBlocks(ranking).flatMap((b) => {
    const entry = ranking.entries.find((e) => e.rank === b.rank)
    let t = b.start
    return (entry?.shots ?? []).flatMap((shot) => {
      const words = wordsAt(wordsOf(b.source), shot.start, shot.end, t)
      t += Math.max(0, shot.end - shot.start)
      return words
    })
  }), style)
