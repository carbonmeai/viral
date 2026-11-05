import type { TranscriptSegment, TranscriptWord } from "@viral/contracts"

// Grok returns one flat word list; segments are only for reading (transcript.txt, agents skimming the
// story). Break after sentence-ending punctuation, at pauses, or when a segment gets long.
const SENTENCE_END = /[.!?…]["')\]]*$/
const PAUSE_S = 0.8
const MAX_WORDS = 30

export const segmentWords = (words: ReadonlyArray<TranscriptWord>): Array<TranscriptSegment> => {
  const segments: Array<TranscriptSegment> = []
  let current: Array<TranscriptWord> = []
  const flush = () => {
    if (current.length === 0) return
    segments.push({
      start: current[0]!.s,
      end: current[current.length - 1]!.e,
      text: current.map((word) => word.w).join(" "),
      words: current
    })
    current = []
  }
  words.forEach((word, i) => {
    current.push(word)
    const next = words[i + 1]
    const pause = next !== undefined && next.s - word.e >= PAUSE_S
    if (SENTENCE_END.test(word.w) || pause || current.length >= MAX_WORDS) flush()
  })
  flush()
  return segments
}
