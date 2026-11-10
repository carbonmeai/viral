import type { TranscriptWord } from "@viral/contracts"

// Whole sentences, as the skill's speech.py finds them: nobody in a short is cut off mid-sentence. Rankings' shots,
// narrated shorts' real lines and cut-down sections all snap with these.

export interface Sentence {
  readonly start: number
  readonly end: number
  readonly text: string
}

const SENTENCE_END = /[.?!…]$/
// Only a long pause ends a sentence: speakers pause mid-sentence ("near death ... to becoming").
export const SENTENCE_GAP = 1.5
// A "sentence" longer than this means the transcript has no punctuation there: it's no guide to where to cut.
export const LONG_SENTENCE = 25
const PAD_IN = 0.08
const PAD_OUT = 0.15
// a cut moved inward keeps at least this share of the shot
const MIN_KEEP = 0.6

// A video's sentences: a word ending in . ? ! … or followed by a pause over 1.5 s ends one.
export const sentencesOf = (words: ReadonlyArray<TranscriptWord>): ReadonlyArray<Sentence> => {
  const out: Array<Sentence> = []
  let current: Array<TranscriptWord> = []
  words.forEach((word, i) => {
    current.push(word)
    const next = words[i + 1]
    if (SENTENCE_END.test(word.w) || next === undefined || next.s - word.e > SENTENCE_GAP) {
      out.push({ start: current[0]!.s, end: current.at(-1)!.e, text: current.map((w) => w.w).join(" ") })
      current = []
    }
  })
  return out
}

export interface SnapOptions {
  readonly maxBack: number
  readonly maxForward: number
  // the video's length
  readonly limit: number
  // ranges the shot must stay out of (ads, end screens)
  readonly blocked: ReadonlyArray<{ readonly start: number; readonly end: number }>
  // the earliest a shot may start (videos that fade in from black)
  readonly minStart: number
}

export interface Snapped {
  readonly start: number
  readonly end: number
  // what moved and why ("out 21.50→23.12 (finish: 'and she ran')")
  readonly notes: ReadonlyArray<string>
  // a cut that still lands mid-sentence, said plainly; null when both ends are on whole sentences
  readonly problem: string | null
}

const round = (t: number) => Math.round(t * 1000) / 1000
const quote = (text: string, n = 50) => text.length <= n ? text : `${text.slice(0, n)}…`

// Moves a shot's in and out points to whole sentences, as the skill's speech.py does: a cut inside a sentence
// stretches outward to keep the sentence whole when that's cheap (up to maxBack / maxForward), else moves inward
// past the partial sentence. A cut it can't fix is a problem, never a cut that ships.
export const snapToSentences = (sentences: ReadonlyArray<Sentence>, start: number, end: number, options: SnapOptions): Snapped => {
  const notes: Array<string> = []
  const problems: Array<string> = []
  const dur = end - start
  const ok = (s: number, e: number) =>
    s >= options.minStart && e <= options.limit && !options.blocked.some((r) => s < r.end && e > r.start)
  // a sentence straddling the in-point. Tighter than speech.py's 50 ms grace: word timings are exact, and a cut a few
  // hundredths into a sentence (a time rounded to 0.1 s) drops its first word ("I think…" → "think…")
  const straddlingIn = sentences.find((x) => x.start - PAD_IN < start - 0.001 && start < x.end - 0.1)
  if (straddlingIn !== undefined) {
    if (start - straddlingIn.start <= options.maxBack && ok(straddlingIn.start - PAD_IN, end)) {
      notes.push(`in ${start.toFixed(2)}→${(straddlingIn.start - PAD_IN).toFixed(2)} (keep whole: '${quote(straddlingIn.text)}')`)
      start = straddlingIn.start - PAD_IN
    } else if (straddlingIn.end + 0.05 < end - MIN_KEEP * dur) {
      notes.push(`in ${start.toFixed(2)}→${(straddlingIn.end + 0.05).toFixed(2)} (skip partial: '${quote(straddlingIn.text)}')`)
      start = straddlingIn.end + 0.05
    } else {
      problems.push(
        `starts mid-sentence ('${quote(straddlingIn.text, 60)}', ${straddlingIn.start.toFixed(1)}–${straddlingIn.end.toFixed(1)}s)`
      )
    }
  }
  // a sentence straddling the out-point
  const straddlingOut = sentences.find((x) => x.start + 0.1 < end && end < x.end + 0.02)
  if (straddlingOut !== undefined) {
    if (straddlingOut.end - end <= options.maxForward && ok(start, straddlingOut.end + PAD_OUT)) {
      notes.push(`out ${end.toFixed(2)}→${(straddlingOut.end + PAD_OUT).toFixed(2)} (finish: '${quote(straddlingOut.text)}')`)
      end = straddlingOut.end + PAD_OUT
    } else if (straddlingOut.start - 0.05 > start + MIN_KEEP * dur) {
      notes.push(`out ${end.toFixed(2)}→${(straddlingOut.start - 0.05).toFixed(2)} (drop partial: '${quote(straddlingOut.text)}')`)
      end = straddlingOut.start - 0.05
    } else {
      problems.push(
        `ends mid-sentence ('${quote(straddlingOut.text, 60)}', ${straddlingOut.start.toFixed(1)}–${straddlingOut.end.toFixed(1)}s)`
      )
    }
  }
  return { start: round(start), end: round(end), notes, problem: problems.length === 0 ? null : problems.join(" and ") }
}

// ---------------------------------------------------------------- real lines (by word)

// Which sentence each word belongs to, by word index: the first and last word index of its sentence.
const sentenceBounds = (words: ReadonlyArray<TranscriptWord>) => {
  const first: Array<number> = []
  const last: Array<number> = []
  let from = 0
  words.forEach((word, i) => {
    const next = words[i + 1]
    if (SENTENCE_END.test(word.w) || next === undefined || next.s - word.e > SENTENCE_GAP) {
      for (let k = from; k <= i; k++) {
        first[k] = from
        last[k] = i
      }
      from = i + 1
    }
  })
  return { first, last }
}

// A quote's words `first`–`last` widened to the whole sentences they sit in: from the first word of the sentence the
// quote starts in to the last word of the sentence it ends in. Unchanged when it's already whole sentences, and at an
// edge whose "sentence" runs over LONG_SENTENCE (no punctuation to go by).
export const wholeSentencesOf = (
  words: ReadonlyArray<TranscriptWord>,
  first: number,
  last: number
): { readonly first: number; readonly last: number } => {
  const bounds = sentenceBounds(words)
  const known = (from: number, to: number) => words[to]!.e - words[from]!.s <= LONG_SENTENCE
  const a = [bounds.first[first] ?? first, bounds.last[first] ?? first] as const
  const b = [bounds.first[last] ?? last, bounds.last[last] ?? last] as const
  return { first: known(a[0], a[1]) ? a[0] : first, last: known(b[0], b[1]) ? b[1] : last }
}
