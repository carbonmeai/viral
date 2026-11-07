import type { ApproachName, Script, ScriptBeat } from "@viral/contracts"
import { clipSource, type SourceContext, sourceField } from "../projects/source-context.ts"
import { locateQuote } from "../transcribe/quote-match.ts"

export interface ScriptLimits {
  // narrated words, inclusive
  readonly narrationWords: readonly [number, number]
  // real lines from the video, inclusive
  readonly reals: readonly [number, number]
  // question-recap keeps the creator's voice for the ending only
  readonly realsOnlyAtEnd: boolean
}

// From the approach skills: a recap narrates more and saves the real voice for the end; an interleaved short
// narrates less and cuts real reactions in throughout.
export const SCRIPT_LIMITS: Partial<Record<ApproachName, ScriptLimits>> = {
  "question-recap": { narrationWords: [80, 130], reals: [0, 3], realsOnlyAtEnd: true },
  "claim-interleaved": { narrationWords: [60, 100], reals: [4, 9], realsOnlyAtEnd: false }
}

const REAL_SECONDS: readonly [number, number] = [0.8, 8]
const HEADLINE_WORDS = 8

export type AdRange = { readonly start: number; readonly end: number }

const countWords = (text: string) => text.split(/\s+/).filter((w) => /\w/.test(w)).length

export const narrationWords = (script: Script) =>
  script.beats.reduce((n, beat) => n + (beat._tag === "Narration" ? countWords(beat.text) : 0), 0)

// Checks a script against its approach and the short's videos (V1 first), and snaps every real line to its own
// video's exact word timings. Returns the snapped script and a list of problems, empty when the script is good.
export const checkScript = (
  script: Script,
  limits: ScriptLimits,
  sources: ReadonlyArray<Pick<SourceContext, "words" | "excluded">>
): { readonly script: Script; readonly problems: ReadonlyArray<string> } => {
  const problems: Array<string> = []
  const beats: Array<ScriptBeat> = script.beats.map((beat, i) => {
    if (beat._tag === "Narration") return beat
    const video = clipSource(sources, beat.source, `beat ${i + 1}`)
    if (video.problem !== null) {
      problems.push(video.problem)
      return beat
    }
    const { words, excluded: ads } = video.source
    const span = locateQuote(words, beat.quote, beat.start)
    if (span === null) {
      problems.push(`beat ${i + 1}: "${beat.quote}" isn't in the transcript near ${beat.start.toFixed(1)}s; quote the words exactly as spoken`)
      return beat
    }
    const length = span.end - span.start
    if (length < REAL_SECONDS[0] || length > REAL_SECONDS[1]) {
      problems.push(`beat ${i + 1}: "${beat.quote}" lasts ${length.toFixed(1)}s; real lines must be ${REAL_SECONDS[0]}–${REAL_SECONDS[1]}s`)
    }
    const ad = ads.find((a) => span.start < a.end && span.end > a.start)
    if (ad !== undefined) {
      problems.push(`beat ${i + 1}: "${beat.quote}" is inside an ad or sponsor read (${ad.start.toFixed(0)}–${ad.end.toFixed(0)}s)`)
    }
    return { _tag: "Real", quote: span.words, start: span.start, end: span.end, ...sourceField(beat.source) }
  })

  if (beats[0]?._tag !== "Narration") problems.push("the script must open with a narrated line (the hook)")
  const words_ = narrationWords(script)
  const [minWords, maxWords] = limits.narrationWords
  if (words_ < minWords || words_ > maxWords) {
    problems.push(`the narration is ${words_} words; this approach needs ${minWords}–${maxWords}. Never pad with anything not in the transcript`)
  }
  const reals = beats.filter((b) => b._tag === "Real").length
  const [minReals, maxReals] = limits.reals
  if (reals < minReals || reals > maxReals) {
    problems.push(`there are ${reals} real lines; this approach needs ${minReals}–${maxReals}`)
  }
  if (limits.realsOnlyAtEnd) {
    const lastNarration = beats.findLastIndex((b) => b._tag === "Narration")
    if (beats.slice(0, lastNarration).some((b) => b._tag === "Real")) {
      problems.push("this approach plays real lines only after the last narrated line")
    }
  }
  if (script.headline !== null && countWords(script.headline.join(" ")) > HEADLINE_WORDS) {
    problems.push(`the headline is longer than ${HEADLINE_WORDS} words`)
  }
  return { script: { headline: script.headline, beats }, problems }
}
