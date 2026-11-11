import { type ApproachName, type ProposedScript, rankingEntries, type Script, type ScriptBeat, type ScriptLimits, type SourceIndex } from "@viral/contracts"
import { clipSource, type SourceContext, sourceField, sourceLabel } from "../projects/source-context.ts"
import { findQuote, spanOf } from "../transcribe/quote-match.ts"
import { wholeSentencesOf } from "../transcribe/sentences.ts"

export type { ScriptLimits } from "@viral/contracts"

// Every real line during the narration: long enough to land, short enough not to stall the story.
const REAL_SECONDS: readonly [number, number] = [0.8, 8]
// Story-recap's ending: real lines after the narration less than this far apart play as one continuous take, so no line
// in between is skipped (the skill's "merge clips that are seconds apart").
export const ENDING_MERGE_GAP = 3

// From the approach skills: a recap narrates more and saves the real voice for the end; an interleaved short
// narrates less and cuts real reactions in throughout; a story recap tells the whole story, 5–8 real lines during the
// narration and the payoff as one long real take (the skill's spicy short: 22.6 s). Every real line is whole sentences.
export const SCRIPT_LIMITS: Partial<Record<ApproachName, ScriptLimits>> = {
  "question-recap": {
    narrationWords: [80, 130],
    reals: [0, 3],
    realsOnlyAtEnd: true,
    realSeconds: REAL_SECONDS,
    ending: null,
    wholeSentences: true
  },
  "claim-interleaved": {
    narrationWords: [60, 100],
    reals: [4, 9],
    realsOnlyAtEnd: false,
    realSeconds: REAL_SECONDS,
    ending: null,
    wholeSentences: true
  },
  // reals counts the payoff take as one: 5–8 during the narration, plus the ending
  "story-recap": {
    narrationWords: [150, 220],
    reals: [6, 9],
    realsOnlyAtEnd: false,
    realSeconds: REAL_SECONDS,
    ending: { seconds: [10, 25] },
    wholeSentences: true
  }
}

// A narrated ranking (the skill's "Top 5 Animal Comebacks"): one entry per video, each about 20–25 s (its narration plus
// 1–2 real lines that answer the narrator), #1's reveal as one real take of 10–25 s after the narration. The word budget
// grows with the entries: the hook, then roughly 22–48 narrated words an entry (rescues5: 214 words for five). A real
// line during a ranking may run longer than in a single-video short (rescues5's donkey line is 13.9 s).
const RANKING_REAL_SECONDS: readonly [number, number] = [0.8, 14]
export const RANKING_ENTRY_SECONDS: readonly [number, number] = [15, 32]
// how fast the narrator reads, to estimate an entry's length before there's a take (Marcus: 3.1–3.3 words a second)
export const ENTRY_WORDS_PER_SECOND = 3.2

export const rankingLimits = (entries: number): ScriptLimits => ({
  narrationWords: [entries * 22 + 8, entries * 48 + 24],
  reals: [entries, entries * 2 + 1],
  realsOnlyAtEnd: false,
  realSeconds: RANKING_REAL_SECONDS,
  ending: { seconds: [10, 25] },
  wholeSentences: true,
  ranking: { entries, realsPerEntry: [1, 2], entrySeconds: RANKING_ENTRY_SECONDS }
})

// The limits a short's script is checked against: its approach's, and for a narrated ranking, one entry per video.
export const scriptLimitsFor = (approach: ApproachName, videos: number): ScriptLimits | undefined =>
  approach === "narrated-ranking" ? rankingLimits(Math.max(videos, 2)) : SCRIPT_LIMITS[approach]

const HEADLINE_WORDS = 8

export type AdRange = { readonly start: number; readonly end: number }

const countWords = (text: string) => text.split(/\s+/).filter((w) => /\w/.test(w)).length

// The narrated words that play in the short (a skipped line is voiced, but not played).
export const narrationWords = (script: Script) =>
  script.beats.reduce((n, beat) => n + (beat._tag === "Narration" && beat.skipped !== true ? countWords(beat.text) : 0), 0)

// What the agent sent as a Script: a real line's V number becomes its position (V2 → source 1; V1 left out). A V
// number the short doesn't have is kept as a position, for checkScript to name.
export const fromProposedScript = (proposed: ProposedScript): Script => ({
  headline: proposed.headline,
  beats: proposed.beats.map((beat) => {
    if (beat._tag === "Narration") return beat.skipped === true ? beat : { _tag: "Narration", text: beat.text }
    if (beat._tag === "Cta") return { _tag: "Cta", question: beat.question }
    const { video, ...rest } = beat
    return { ...rest, ...sourceField(video === undefined ? undefined : (video - 1) as SourceIndex) }
  })
})

type Real = Extract<ScriptBeat, { readonly _tag: "Real" }>

const fmt = (t: number) => t.toFixed(1)
const short = (text: string, n = 70) => text.length <= n ? text : `${text.slice(0, n)}…`

// The real lines after the last narrated line that play as the ending's one take: the last run of them from one video,
// each less than ENDING_MERGE_GAP after the one before. Indices into `beats`; empty when the script ends on narration.
const endingRun = (beats: ReadonlyArray<ScriptBeat>): ReadonlyArray<number> => {
  const run: Array<number> = []
  for (let i = beats.length - 1; i >= 0; i--) {
    const beat = beats[i]!
    if (beat._tag !== "Real") break
    const later = run.length === 0 ? null : beats[run[0]!] as Real
    if (later !== null && ((later.source ?? 0) !== (beat.source ?? 0) || later.start - beat.end >= ENDING_MERGE_GAP || later.start < beat.start)) break
    run.unshift(i)
  }
  return run
}

// The closing question (story-arc's "The closing question"): one short question about the viewer, tied to the topic.
// The narrator adds "Tell us in the comments, and subscribe for more." after it, so the question carries no ask.
export const CLOSING_WORDS: readonly [number, number] = [3, 14]

export const checkClosingQuestion = (question: string): ReadonlyArray<string> => {
  const text = question.trim()
  const problems: Array<string> = []
  const words = countWords(text)
  if (!text.endsWith("?")) problems.push(`the closing question "${short(text, 60)}" must be one question, ending in "?"`)
  else if ((text.match(/\?/g) ?? []).length > 1) problems.push(`the closing question "${short(text, 60)}" asks more than one question; ask one`)
  if (words < CLOSING_WORDS[0] || words > CLOSING_WORDS[1]) {
    problems.push(`the closing question is ${words} words; keep it to ${CLOSING_WORDS[0]}–${CLOSING_WORDS[1]}`)
  }
  if (/\b(subscribe|comments?|like and)\b/i.test(text)) {
    problems.push("write only the question; the narrator adds \"Tell us in the comments, and subscribe for more.\" after it")
  }
  return problems
}

// Checks a script against its approach and the short's videos (V1 first), and snaps every real line to its own
// video's exact word timings, widened to whole sentences when the approach says so. With an `ending`, the real lines
// that end the script close together merge into one take, everything said between them included. `closing`: the
// style ends with a comment question, so the script must end with one Cta beat (and without it, must have none). The
// Cta beat sits outside every other check: the word and real-line budgets, "ends on the payoff", "real lines only at
// the end". Returns the snapped script and a list of problems, empty when the script is good.
export const checkScript = (
  script: Script,
  limits: ScriptLimits,
  sources: ReadonlyArray<Pick<SourceContext, "words" | "excluded">>,
  closing: boolean = false
): { readonly script: Script; readonly problems: ReadonlyArray<string> } => {
  const ctas = script.beats.flatMap((beat, i) => beat._tag === "Cta" ? [{ beat, i }] : [])
  const story = checkStory({ headline: script.headline, beats: script.beats.filter((b) => b._tag !== "Cta") }, limits, sources)
  const problems = [...story.problems]
  const cta = ctas.at(-1)?.beat
  if (closing && cta === undefined) {
    problems.push("this style ends with a closing question: add a Cta beat after the payoff with one question for the comments about the viewer (\"What's the hottest pepper you've ever eaten?\")")
  } else if (!closing && cta !== undefined) {
    problems.push("this style doesn't end with a closing question; leave out the Cta beat")
  }
  if (ctas.length > 1) problems.push(`there are ${ctas.length} closing questions; write one, as the last beat`)
  else if (ctas.length === 1 && ctas[0]!.i !== script.beats.length - 1) problems.push("the closing question goes last, after the payoff")
  if (closing && cta !== undefined) problems.push(...checkClosingQuestion(cta.question))
  const beats = closing && cta !== undefined ? [...story.script.beats, { _tag: "Cta" as const, question: cta.question.trim() }] : story.script.beats
  return { script: { headline: story.script.headline, beats }, problems }
}

// The story's own checks: every beat but the closing question.
const checkStory = (
  script: Script,
  limits: ScriptLimits,
  sources: ReadonlyArray<Pick<SourceContext, "words" | "excluded">>
): { readonly script: Script; readonly problems: ReadonlyArray<string> } => {
  // each beat's problems, so they read in script order
  const perBeat: Array<Array<string>> = script.beats.map(() => [])
  // each real line found in its video: its words (by index), before any length checks
  const located = script.beats.map((beat, i) => {
    if (beat._tag !== "Real") return null
    const video = clipSource(sources, beat.source, `beat ${i + 1}`)
    if (video.problem !== null) {
      perBeat[i]!.push(video.problem)
      return null
    }
    const { words } = video.source
    const found = findQuote(words, beat.quote, beat.start)
    if (found === null) {
      const where = sources.length > 1 ? `${sourceLabel(beat.source ?? 0)}'s transcript` : "the transcript"
      perBeat[i]!.push(`beat ${i + 1}: "${beat.quote}" isn't in ${where} near ${beat.start.toFixed(1)}s; quote the words exactly as spoken`)
      return null
    }
    const whole = limits.wholeSentences ? wholeSentencesOf(words, found.first, found.last) : found
    return { words, ...whole }
  })

  const snapped: Array<ScriptBeat> = script.beats.map((beat, i) => {
    const at = located[i]
    if (beat._tag !== "Real" || at === null || at === undefined) return beat
    const span = spanOf(at.words, at.first, at.last)
    return { _tag: "Real", quote: span.words, start: span.start, end: span.end, ...sourceField(beat.source) }
  })

  // the ending's take: one real line from the first line of the run to the last, every word between them included
  const run = limits.ending === null ? [] : endingRun(snapped).filter((i) => located[i] !== null)
  const beats: Array<ScriptBeat> = run.length < 2 ? snapped : (() => {
    const first = located[run[0]!]!
    const last = located[run.at(-1)!]!
    const span = spanOf(first.words, first.first, last.last)
    const take: ScriptBeat = { _tag: "Real", quote: span.words, start: span.start, end: span.end, ...sourceField((snapped[run[0]!] as Real).source) }
    return [...snapped.slice(0, run[0]!), take, ...snapped.slice(run.at(-1)! + 1)]
  })()
  // the merged ending's take stands where its first line was (the run ends the script, so no beat after it moves)
  const endingAt = run.length < 2 ? -1 : run[0]!

  beats.forEach((beat, i) => {
    if (beat._tag !== "Real") return
    const problems = perBeat[i]!
    const source = sources[beat.source ?? 0]
    if (source === undefined || located[i] === null) return
    const original = script.beats[i] as Real
    const name = i === endingAt ? `the ending (beats ${run[0]! + 1}–${run.at(-1)! + 1})` : `beat ${i + 1}`
    const length = beat.end - beat.start
    const isEnding = limits.ending !== null && i === beats.length - 1 && beats.findLastIndex((b) => b._tag === "Narration") < i
    const [min, max] = isEnding ? limits.ending!.seconds : limits.realSeconds
    const widened = limits.wholeSentences && beat.quote.split(/\s+/).length > original.quote.split(/\s+/).filter((w) => w !== "").length
      && i !== endingAt
    if (length > max && widened) {
      problems.push(`${name}: "${short(original.quote)}" cuts a sentence; as whole sentences it's "${short(beat.quote)}" (${fmt(length)}s), over ${max}s. Quote a shorter whole sentence`)
    } else if (length < min || length > max) {
      problems.push(isEnding
        ? `${name}: the payoff take lasts ${fmt(length)}s; this approach ends on one continuous real take of ${min}–${max}s (lines less than ${ENDING_MERGE_GAP}s apart join into one)`
        : `${name}: "${short(original.quote)}" lasts ${fmt(length)}s; real lines must be ${min}–${max}s`)
    }
    const ad = source.excluded.find((a) => beat.start < a.end && beat.end > a.start)
    if (ad !== undefined) {
      problems.push(`${name}: "${short(i === endingAt ? beat.quote : original.quote)}" is inside an ad or sponsor read (${ad.start.toFixed(0)}–${ad.end.toFixed(0)}s)`)
    }
  })
  const problems = perBeat.flat()

  if (beats[0]?._tag !== "Narration") problems.push("the script must open with a narrated line (the hook)")
  if (beats[0]?._tag === "Narration" && beats[0].skipped === true) problems.push("the hook can't be skipped")
  beats.forEach((beat, k) => {
    if (beat._tag !== "Narration" || beat.skipped !== true || k === 0) return
    if (beats[k - 1]?._tag !== "Real") {
      problems.push(`"${short(beat.text, 50)}" is skipped but doesn't follow a real line; only a line the real line before it says can be skipped`)
    } else if (!(beats[k + 1]?._tag === "Narration" && (beats[k + 1] as { readonly skipped?: boolean }).skipped !== true)) {
      problems.push(`"${short(beat.text, 50)}" is skipped, so a narrated line that plays must come straight after it`)
    }
  })
  const words_ = narrationWords(script)
  const [minWords, maxWords] = limits.narrationWords
  if (words_ < minWords || words_ > maxWords) {
    problems.push(`the narration is ${words_} words; this approach needs ${minWords}–${maxWords}. Never pad with anything not in the transcript`)
  }
  const reals = beats.filter((b) => b._tag === "Real").length
  const [minReals, maxReals] = limits.reals
  if (reals < minReals || reals > maxReals) {
    problems.push(limits.ending === null
      ? `there are ${reals} real lines; this approach needs ${minReals}–${maxReals}`
      : `there are ${reals} real lines; this approach needs ${minReals}–${maxReals}: ${minReals - 1}–${maxReals - 1} during the narration, then the payoff take`)
  }
  if (limits.ending !== null && beats.at(-1)?._tag !== "Real") {
    problems.push("the script ends on the payoff: one continuous real take after the last narrated line")
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
  if (limits.ranking !== undefined) problems.push(...checkCountdown(beats, limits.ranking, limits.ending !== null))
  return { script: { headline: script.headline, beats }, problems }
}

const RANK_NAMES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
const said = (rank: number) => `"Number ${RANK_NAMES[rank] ?? rank}"`

// A narrated ranking's countdown (the approach-narrated-ranking skill): after a narrated hook, one entry per video,
// opening on "Number N" from N down to 1, each with 1–2 real lines from its own video (#1's reveal take is in #1's
// entry, not counted) and about 20–25 s long. `beats`: the snapped script without its closing question.
export const checkCountdown = (
  beats: ReadonlyArray<ScriptBeat>,
  ranking: NonNullable<ScriptLimits["ranking"]>,
  endsOnTake: boolean
): ReadonlyArray<string> => {
  const n = ranking.entries
  const { hookEnd, entries } = rankingEntries(beats, n)
  const expected = Array.from({ length: n }, (_, i) => n - i)
  if (entries.length === 0) {
    return [`a narrated ranking counts down ${n} entries, one per video: open each entry on a narrated line starting ${said(n)}, … down to ${said(1)}`]
  }
  const problems: Array<string> = []
  const ranks = entries.map((e) => e.rank)
  if (ranks.join(",") !== expected.join(",")) {
    problems.push(`the countdown goes ${ranks.map((r) => `#${r}`).join(", ")}; it must be ${expected.map((r) => `#${r}`).join(", ")}: one entry per video, each opening on a narrated line starting ${said(n)}, then ${said(n - 1)}, … ${said(1)} last`)
  }
  if (beats.slice(0, hookEnd).some((b) => b._tag === "Real")) {
    problems.push(`the hook (everything before ${said(n)}) is narration only; real lines go inside the entries`)
  }
  // the reveal take: the real lines after the last narrated line, at the end of the last entry
  const lastNarration = beats.findLastIndex((b) => b._tag === "Narration")
  const owner = new Map<number, number>()
  for (const entry of entries) {
    const name = `entry #${entry.rank}`
    const inside = beats.slice(entry.start, entry.end).map((beat, k) => ({ beat, i: entry.start + k }))
    const reals = inside.filter(({ beat, i }) => beat._tag === "Real" && !(endsOnTake && i > lastNarration))
    const [minReals, maxReals] = ranking.realsPerEntry
    if (reals.length < minReals || reals.length > maxReals) {
      problems.push(`${name} has ${reals.length} real ${reals.length === 1 ? "line" : "lines"}; each entry cuts in ${minReals}–${maxReals} that answer the narrator${entry.rank === 1 && endsOnTake ? " (#1's reveal take after the narration isn't counted)" : ""}`)
    }
    const videos = [...new Set(inside.flatMap(({ beat }) => beat._tag === "Real" ? [beat.source ?? 0] : []))]
    if (videos.length > 1) {
      problems.push(`${name}'s real lines come from ${videos.map((v) => sourceLabel(v)).join(" and ")}; every real line of an entry comes from that entry's own video`)
    } else if (videos.length === 1) {
      const other = owner.get(videos[0]!)
      if (other !== undefined) problems.push(`entries #${other} and #${entry.rank} both use ${sourceLabel(videos[0]!)}; each video is one entry`)
      else owner.set(videos[0]!, entry.rank)
    }
    const words = inside.reduce((w, { beat }) => w + (beat._tag === "Narration" && beat.skipped !== true ? countWords(beat.text) : 0), 0)
    const clips = reals.reduce((t, { beat }) => t + (beat._tag === "Real" ? beat.end - beat.start : 0), 0)
    const seconds = words / ENTRY_WORDS_PER_SECOND + clips
    const [min, max] = ranking.entrySeconds
    if (seconds < min || seconds > max) {
      problems.push(`${name} runs about ${fmt(seconds)}s (${words} narrated words ≈ ${fmt(words / ENTRY_WORDS_PER_SECOND)}s + ${fmt(clips)}s of real lines${entry.rank === 1 && endsOnTake ? ", before the reveal take" : ""}); keep each entry about 20–25 s (${min}–${max})`)
    }
  }
  if (endsOnTake && entries.at(-1)?.rank !== 1 && ranks.includes(1)) problems.push(`#1 comes last, so its reveal take ends the short`)
  return problems
}
