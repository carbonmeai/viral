import type { ChatCheck, CutRenderPlan, NarratedPlan, RankingRenderPlan, ReadBack, ReadBackCheck, TranscriptWord } from "@viral/contracts"
import { LONG_SENTENCE, type Sentence, sentencesOf } from "../transcribe/sentences.ts"

// The final-video check (viral-shorts step 7: "transcribe the FINAL mp4 and read every line"). The render's audio is
// transcribed, then read back against what the plan says the short plays, in order: the narration (the take's own
// words, without the lines the short skips), every real clip (its video's words in the played seconds) and the
// closing line. Pure: the stage transcribes and finds the silences, this reads them.

// ---------------------------------------------------------------- what the short should say

export interface ExpectedPiece {
  readonly kind: "narration" | "real" | "closing"
  // "the narration", "real line 2", "#3 clip 1", "section 4"
  readonly label: string
  readonly words: ReadonlyArray<string>
  // a real clip against its video's transcript: the words of its first sentence it leaves out before it, and of its last
  // sentence after it (null when it starts and ends on whole sentences)
  readonly startsMid: string | null
  readonly endsMid: string | null
}

export interface ReadBackPlan {
  readonly pieces: ReadonlyArray<ExpectedPiece>
  // narration voiced in the take that the short jumps over, and the real clip it follows (an index into `pieces`)
  readonly skipped: ReadonlyArray<{ readonly words: ReadonlyArray<string>; readonly afterPiece: number }>
  // the style's closing question: spoken by the narrator, on a silent card, wanted but missing, or not wanted (null)
  readonly closing: "spoken" | "card" | "missing" | null
  // a narrated ranking's entries: "Number N" … "Number 1" must be heard in that order
  readonly countdown: number | null
  // seconds at the end that are silent on purpose (a cut-down's end card)
  readonly silentTail: number
  readonly durationS: number
}

// A video's words and sentences, read once for all of its clips.
export interface SourceText {
  readonly words: ReadonlyArray<TranscriptWord>
  readonly sentences: ReadonlyArray<Sentence>
}
export const sourceText = (words: ReadonlyArray<TranscriptWord>): SourceText => ({ words, sentences: sentencesOf(words) })

const short = (text: string, n = 50) => text.length <= n ? text : `${text.slice(0, n).trimEnd()}…`
const shortStart = (text: string, n = 50) => text.length <= n ? text : `…${text.slice(-n).trimStart()}`

// A real clip: its video's words whose middle falls in the played seconds, and whether it cuts a sentence there.
export const realPiece = (label: string, source: SourceText | undefined, start: number, end: number): ExpectedPiece => {
  if (source === undefined) return { kind: "real", label, words: [], startsMid: null, endsMid: null }
  const inside = source.words.filter((w) => (w.s + w.e) / 2 >= start && (w.s + w.e) / 2 <= end)
  const first = inside[0]
  const last = inside.at(-1)
  const sentenceOf = (w: TranscriptWord) => source.sentences.find((x) => x.start <= w.s + 0.001 && w.e <= x.end + 0.001)
  const known = (x: Sentence) => x.end - x.start <= LONG_SENTENCE
  const opening = first === undefined ? undefined : sentenceOf(first)
  const closing = last === undefined ? undefined : sentenceOf(last)
  return {
    kind: "real",
    label,
    words: inside.map((w) => w.w),
    startsMid: opening !== undefined && known(opening) && opening.start < first!.s - 0.01
      ? shortStart(source.words.filter((w) => w.s >= opening.start - 0.001 && w.e <= first!.s + 0.001).map((w) => w.w).join(" "))
      : null,
    endsMid: closing !== undefined && known(closing) && closing.end > last!.e + 0.01
      ? short(source.words.filter((w) => w.s >= last!.e - 0.001 && w.e <= closing.end + 0.001).map((w) => w.w).join(" "))
      : null
  }
}

const sourceOf = (sources: ReadonlyMap<number, SourceText>, index: number | undefined) => sources.get(index ?? 0)

// A narrated short as the renderer plays it: the take's words up to each insert's word, the clip, the take again (from
// the insert's resume word when the script skips a line), the outro clips, then the closing line under the end card.
export const narratedReadBackPlan = (
  plan: NarratedPlan,
  take: ReadonlyArray<TranscriptWord>,
  sources: ReadonlyMap<number, SourceText>,
  options: { readonly closingWanted: boolean; readonly countdown: number | null; readonly durationS: number }
): ReadBackPlan => {
  const storyEnd = plan.narration_end ?? Number.POSITIVE_INFINITY
  const story = take.filter((w) => w.s < storyEnd)
  const pieces: Array<ExpectedPiece> = []
  const skipped: Array<{ words: ReadonlyArray<string>; afterPiece: number }> = []
  const narration = (from: number, to: number) => {
    const words = story.slice(from, to).map((w) => w.w)
    if (words.length > 0) pieces.push({ kind: "narration", label: "the narration", words, startsMid: null, endsMid: null })
  }
  let next = 0
  let reals = 0
  for (const insert of [...(plan.inserts ?? [])].sort((a, b) => a.after_word - b.after_word)) {
    narration(next, insert.after_word + 1)
    pieces.push(realPiece(`real line ${++reals}`, sourceOf(sources, insert.source), insert.start, insert.end))
    const resume = insert.resume_word ?? insert.after_word + 1
    if (resume > insert.after_word + 1) {
      skipped.push({ words: story.slice(insert.after_word + 1, resume).map((w) => w.w), afterPiece: pieces.length - 1 })
    }
    next = Math.max(next, resume)
  }
  narration(next, story.length)
  for (const clip of plan.outro ?? []) pieces.push(realPiece(`real line ${++reals}`, sourceOf(sources, clip.source), clip.start, clip.end))
  const cta = plan.cta
  if (cta?.vo_start !== undefined) {
    const words = take.filter((w) => w.s >= cta.vo_start! - 0.05 && w.e <= (cta.vo_end ?? Number.POSITIVE_INFINITY) + 0.05).map((w) => w.w)
    if (words.length > 0) pieces.push({ kind: "closing", label: "the closing line", words, startsMid: null, endsMid: null })
  }
  return {
    pieces,
    skipped,
    closing: !options.closingWanted ? null : cta?.vo_start !== undefined ? "spoken" : cta !== undefined ? "card" : "missing",
    countdown: options.countdown,
    silentTail: 0,
    durationS: options.durationS
  }
}

// A cut-down short: its sections in order; the closing question is a silent card.
export const cutReadBackPlan = (
  plan: CutRenderPlan,
  sources: ReadonlyMap<number, SourceText>,
  options: { readonly closingWanted: boolean; readonly durationS: number }
): ReadBackPlan => ({
  pieces: plan.sections.map((s, i) => realPiece(`section ${i + 1}`, sourceOf(sources, s.source), s.start, s.end)),
  skipped: [],
  closing: !options.closingWanted ? null : plan.cta !== undefined ? "card" : "missing",
  countdown: null,
  silentTail: plan.cta === undefined ? 0 : (plan.cta.seconds ?? 3) + (plan.cta.crossfade ?? 0.35),
  durationS: options.durationS
})

// A list ranking: every entry's clips in playing order, each with its own sound (no narrator, no closing line).
export const rankingReadBackPlan = (plan: RankingRenderPlan, sources: ReadonlyMap<number, SourceText>, durationS: number): ReadBackPlan => ({
  pieces: plan.order.flatMap((rank) => {
    const item = plan.items.find((i) => i.rank === rank)
    return item === undefined ? [] : item.shots.map((s, k) => realPiece(`#${rank} clip ${k + 1}`, sources.get(s.source), s.src, s.src + s.dur))
  }),
  skipped: [],
  closing: null,
  countdown: null,
  silentTail: 0,
  durationS
})

// ---------------------------------------------------------------- matching heard words to expected ones

const NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]

// A word as compared: lower case, no punctuation or apostrophes, small numbers spelt out ("5" = "five").
export const norm = (word: string): string => {
  const w = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  return /^\d+$/.test(w) && Number(w) <= 20 ? NUMBERS[Number(w)]! : w
}

// "#5" is heard as "number five"
const tokensOf = (words: ReadonlyArray<string>) =>
  words.flatMap((w) => /^#\d{1,2}\b/.test(w.trim()) ? ["number", norm(w.trim().slice(1))] : [norm(w)]).filter((t) => t !== "")

const editDistance = (a: string, b: string) => {
  if (Math.abs(a.length - b.length) > 1) return 2
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]!
}

// Transcribers disagree on spellings ("capsaicin" / "capsacin"), so a long word one letter off still matches.
const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && editDistance(a, b) <= 1)

// The longest run of matching words in order (LCS): for each expected token, the heard token it was matched to, or -1.
export const align = (expected: ReadonlyArray<string>, heard: ReadonlyArray<string>): Int32Array => {
  const n = expected.length
  const m = heard.length
  const width = m + 1
  const table = new Int32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = same(expected[i]!, heard[j]!)
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }
  const matched = new Int32Array(n).fill(-1)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (same(expected[i]!, heard[j]!) && table[i * width + j] === table[(i + 1) * width + j + 1]! + 1) {
      matched[i] = j
      i++
      j++
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++
    else j++
  }
  return matched
}

// ---------------------------------------------------------------- reading it back

export const clock = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, "0")}`
}

const quoteOf = (words: ReadonlyArray<string>, n = 8) => {
  const text = words.slice(0, n).join(" ")
  return `“${words.length > n ? `${text}…` : text}”`
}

// most warnings of one kind listed one by one; the rest are counted
const MAX_EACH = 4
// silence longer than this is said (ffmpeg's silencedetect at −40 dB, run by the stage)
export const SILENCE_SECONDS = 1.2
// below this share of the expected words heard, the whole read-back is a warning
const HEARD_OK = 0.85

// Reads the final transcript back against the plan. `silences`: [start, end] stretches of the mp4's audio below the
// silence floor. Every check is a pass or a warning with the moment it's about.
export const readBack = (
  plan: ReadBackPlan,
  heardWords: ReadonlyArray<TranscriptWord>,
  silences: ReadonlyArray<readonly [number, number]>
): ReadonlyArray<ReadBackCheck> => {
  const checks: Array<ReadBackCheck> = []
  const heard = heardWords.flatMap((w) => tokensOf([w.w]).map((t) => ({ t, s: w.s, e: w.e })))
  // every expected token, with its piece
  const expected = plan.pieces.flatMap((p, pi) => tokensOf(p.words).map((t) => ({ t, piece: pi })))
  const matched = align(expected.map((x) => x.t), heard.map((h) => h.t))
  const ranges = plan.pieces.map((_, pi) => {
    const ks = expected.flatMap((x, k) => x.piece === pi ? [k] : [])
    return { first: ks[0] ?? -1, last: ks.at(-1) ?? -1, count: ks.length, heard: ks.filter((k) => matched[k]! >= 0).length }
  })
  // where an expected token sits in the short: its own heard time, else the nearest heard one before (or after) it
  const timeAt = (k: number): number | null => {
    for (let i = k; i >= 0; i--) if (matched[i]! >= 0) return heard[matched[i]!]!.e
    for (let i = k + 1; i < expected.length; i++) if (matched[i]! >= 0) return heard[matched[i]!]!.s
    return null
  }
  const startOf = (pi: number) => {
    const r = ranges[pi]!
    for (let k = r.first; k >= 0 && k <= r.last; k++) if (matched[k]! >= 0) return heard[matched[k]!]!.s
    return r.first < 0 ? null : timeAt(r.first)
  }
  const add = (kind: ReadBackCheck["kind"], ok: boolean, text: string, at: number | null = null) => checks.push({ kind, ok, text, at })
  const capped = (kind: ReadBackCheck["kind"], warnings: ReadonlyArray<{ readonly text: string; readonly at: number | null }>) => {
    warnings.slice(0, MAX_EACH).forEach((w) => add(kind, false, w.text, w.at))
    if (warnings.length > MAX_EACH) add(kind, false, `…and ${warnings.length - MAX_EACH} more like it`)
  }

  // ── how much of it was heard
  const total = expected.length
  const got = matched.reduce((n, j) => n + (j >= 0 ? 1 : 0), 0)
  if (total > 0) {
    const share = got / total
    add("heard", share >= HEARD_OK, `Heard ${got} of the ${total} words the short should say (${Math.round(share * 100)}%)`)
  }

  // ── the joins: where two pieces meet, nothing missing and nothing extra (a clipped word, a garbled overlap)
  const joinIssues = new Map<number, { readonly text: string; readonly at: number | null }>()
  for (let pi = 0; pi + 1 < plan.pieces.length; pi++) {
    const a = ranges[pi]!
    const b = ranges[pi + 1]!
    if (a.count === 0 || b.count === 0) continue
    let lastA = a.last
    while (lastA >= a.first && matched[lastA]! < 0) lastA--
    let firstB = b.first
    while (firstB <= b.last && matched[firstB]! < 0) firstB++
    if (lastA < a.first || firstB > b.last) continue // a piece not heard at all is said below
    const missingA = expected.slice(lastA + 1, a.last + 1).map((x) => x.t)
    const missingB = expected.slice(b.first, firstB).map((x) => x.t)
    const extra = heard.slice(matched[lastA]! + 1, matched[firstB]!).map((h) => h.t)
    const missing = missingA.length + missingB.length
    if (missing >= 2 || (missing >= 1 && extra.length >= 1) || extra.length >= 3) {
      const at = heard[matched[lastA]!]!.e
      const what = `from ${plan.pieces[pi]!.label} into ${plan.pieces[pi + 1]!.label}`
      const lost = missing === 0 ? "" : ` lost “${[...missingA, "|", ...missingB].join(" ").replace(/^\| | \|$/g, "")}”`
      const added = extra.length === 0 ? "" : `${lost === "" ? "" : ","} heard “${extra.slice(0, 8).join(" ")}” instead`
      joinIssues.set(pi, { text: `The join ${what} doesn't read cleanly:${lost}${added}`, at })
    }
  }

  // ── the skipped lines: voiced in the take, never heard in the short
  const skippedHeard = new Set<number>()
  if (plan.skipped.length > 0) {
    const used = new Set(Array.from(matched).filter((j) => j >= 0))
    const warnings: Array<{ text: string; at: number | null }> = []
    for (const line of plan.skipped) {
      const target = tokensOf(line.words)
      const after = ranges[line.afterPiece + 1]
      const fromK = ranges[line.afterPiece]?.first ?? 0
      const from = (() => {
        for (let k = fromK; k >= 0; k--) if (matched[k]! >= 0) return matched[k]!
        return 0
      })()
      const to = (() => {
        if (after === undefined) return heard.length
        for (let k = after.first; k >= 0 && k <= after.last; k++) if (matched[k]! >= 0) return matched[k]! + 3
        return heard.length
      })()
      const window = heard.slice(from, Math.min(heard.length, to)).filter((_, i) => !used.has(from + i))
      const hits = target.length < 2 ? new Int32Array(0) : align(target, window.map((h) => h.t))
      const found = hits.reduce((n, j) => n + (j >= 0 ? 1 : 0), 0)
      if (target.length >= 2 && found / target.length >= 0.6) {
        const first = hits.find((j) => j >= 0)
        warnings.push({ text: `A skipped line is heard: ${quoteOf(line.words)}`, at: first === undefined ? null : window[first]!.s })
        skippedHeard.add(line.afterPiece)
      }
    }
    if (warnings.length === 0) add("skipped", true, plan.skipped.length === 1 ? "The skipped line isn't heard" : `None of the ${plan.skipped.length} skipped lines is heard`)
    else capped("skipped", warnings)
  }

  // ── the narration: every word of the take that should play is heard
  const narrationWarnings: Array<{ text: string; at: number | null }> = []
  let narrationWords = 0
  plan.pieces.forEach((p, pi) => {
    if (p.kind !== "narration") return
    const r = ranges[pi]!
    narrationWords += r.count
    if (r.count > 0 && r.heard === 0) {
      narrationWarnings.push({ text: `A narration line isn't heard: ${quoteOf(p.words)}`, at: startOf(pi) })
      return
    }
    // runs of missing words inside the line (its edges are the joins')
    let run: Array<number> = []
    const flush = () => {
      const inside = run.length > 0 && run[0]! > r.first && run.at(-1)! < r.last
      if (run.length >= 3 && inside) {
        narrationWarnings.push({ text: `Narration not heard: “${run.map((k) => expected[k]!.t).join(" ")}”`, at: timeAt(run[0]!) })
      }
      run = []
    }
    for (let k = r.first; k <= r.last; k++) {
      if (matched[k]! < 0) run.push(k)
      else flush()
    }
    flush()
  })
  if (narrationWords > 0) {
    if (narrationWarnings.length === 0) add("narration", true, `The narration reads as written (${narrationWords} words)`)
    else capped("narration", narrationWarnings)
  }

  // ── the real clips: whole sentences in their video, and heard
  const realWarnings: Array<{ text: string; at: number | null }> = []
  let realCount = 0
  plan.pieces.forEach((p, pi) => {
    if (p.kind !== "real") return
    realCount++
    const r = ranges[pi]!
    const at = startOf(pi)
    const name = p.label.charAt(0).toUpperCase() + p.label.slice(1)
    if (p.startsMid !== null) realWarnings.push({ text: `${name} starts mid-sentence (it leaves out “${p.startsMid}” before it)`, at })
    if (p.endsMid !== null) {
      realWarnings.push({ text: `${name} stops mid-sentence (the sentence goes on: “${p.endsMid}”)`, at: r.last >= 0 ? timeAt(r.last) : at })
    }
    if (r.count > 0 && r.heard === 0) realWarnings.push({ text: `${name} isn't heard: ${quoteOf(p.words)}`, at })
    else if (r.count >= 3 && r.heard / r.count < 0.5) {
      realWarnings.push({ text: `${name} is hard to hear: ${r.heard} of its ${r.count} words heard (${quoteOf(p.words)})`, at })
    }
  })
  if (realCount > 0) {
    if (realWarnings.length === 0) {
      add("real-line", true, `${realCount === 1 ? "The real clip starts and ends" : `All ${realCount} real clips start and end`} on whole sentences, and ${realCount === 1 ? "is" : "are"} heard`)
    } else capped("real-line", realWarnings)
  }

  // the joins, unless the skipped line explains the extra words
  const joins = [...joinIssues.entries()].filter(([pi]) => !skippedHeard.has(pi) && !skippedHeard.has(pi + 1)).map(([, w]) => w)
  const joinCount = Math.max(0, plan.pieces.length - 1)
  if (joinCount > 0) {
    if (joins.length === 0) add("join", true, joinCount === 1 ? "The join reads cleanly" : `All ${joinCount} joins read cleanly`)
    else capped("join", joins)
  }

  // ── the closing question and the subscribe line
  if (plan.closing === "spoken") {
    const pi = plan.pieces.findIndex((p) => p.kind === "closing")
    const r = pi < 0 ? null : ranges[pi]!
    const subscribe = heard.some((h) => h.t === "subscribe")
    const at = pi < 0 ? null : startOf(pi)
    if (r === null || r.count === 0 || r.heard / r.count < 0.6) add("closing", false, "The closing question isn't heard clearly", at)
    else if (!subscribe) add("closing", false, "The closing question is heard, but not the subscribe line", at)
    else add("closing", true, "The closing question and the subscribe line are heard", at)
  } else if (plan.closing === "card") {
    add("closing", true, "The closing question is on the end card (silent, so it's read on screen, not heard)", Math.max(0, plan.durationS - plan.silentTail))
  } else if (plan.closing === "missing") {
    add("closing", false, "The style ends with a comment question, but this short has none: run it again from the script (or sections) to add one")
  }

  // ── a narrated ranking's countdown: "Number N" … "Number 1", in order (a hook may tease "number one" before it)
  if (plan.countdown !== null && plan.countdown > 0) {
    const said: Array<{ rank: number; at: number }> = []
    heard.forEach((h, i) => {
      const n = heard[i + 1] === undefined ? -1 : NUMBERS.indexOf(heard[i + 1]!.t)
      if (h.t === "number" && n >= 1) said.push({ rank: n, at: h.s })
    })
    const startAt = said.findIndex((x) => x.rank === plan.countdown)
    const found: Array<{ rank: number; at: number }> = []
    const problems: Array<{ text: string; at: number | null }> = []
    let from = startAt < 0 ? 0 : startAt
    for (let rank = plan.countdown; rank >= 1; rank--) {
      const k = said.findIndex((x, i) => i >= from && x.rank === rank)
      if (k >= 0) {
        found.push(said[k]!)
        from = k + 1
      } else {
        const elsewhere = said.find((x) => x.rank === rank)
        problems.push(elsewhere === undefined
          ? { text: `“Number ${rank}” isn't heard`, at: found.at(-1)?.at ?? null }
          : { text: `“Number ${rank}” comes out of order`, at: elsewhere.at })
      }
    }
    if (problems.length === 0) {
      add("countdown", true, `The countdown is heard in order: ${found.map((x) => `#${x.rank} ${clock(x.at)}`).join(", ")}`, found[0]?.at ?? null)
    } else capped("countdown", problems)
  }

  // ── silence: nothing over SILENCE_SECONDS, except the silent end card
  const quietEnd = plan.durationS - plan.silentTail - 0.3
  const silent = silences.filter(([s, e]) => e - s >= SILENCE_SECONDS && !(plan.silentTail > 0 && s >= quietEnd))
  if (silent.length === 0) add("silence", true, `No silence over ${SILENCE_SECONDS} s`)
  else capped("silence", silent.map(([s, e]) => ({ text: `Silent for ${(e - s).toFixed(1)} s`, at: s })))

  return checks
}

// The stage's one line for the run's progress: how many warnings, or that it all read back.
export const readBackSummary = (checks: ReadonlyArray<ReadBackCheck>): string => {
  const warnings = checks.filter((c) => !c.ok)
  return warnings.length === 0
    ? "read back the finished short: every check passed"
    : `read back the finished short: ${warnings.length} ${warnings.length === 1 ? "thing" : "things"} to look at (${warnings.slice(0, 2).map((w) => w.text).join("; ")}${warnings.length > 2 ? "…" : ""})`
}

// The chat's render card: what the read-back found, in the order it was checked, each with its moment (the chat seeks
// there).
export const readBackChatChecks = (heard: ReadBack | undefined): ReadonlyArray<ChatCheck> =>
  heard === undefined ? [] : heard.checks.map((c) => c.at === null ? { text: c.text, ok: c.ok } : { text: c.text, ok: c.ok, at: c.at })

// The render card's sentence about the read-back: how it went, or why it didn't run.
export const readBackNote = (heard: ReadBack | undefined): string => {
  if (heard === undefined) return ""
  if (heard.problem !== null) return ` The finished short wasn't read back: ${heard.problem}.`
  const warnings = heard.checks.filter((c) => !c.ok).length
  const how = `${heard.provider === "grok" ? "Grok" : "local Whisper"}, ${heard.seconds.toFixed(0)} s`
  return warnings === 0
    ? ` I read the finished short back (${how}): everything it should say is there.`
    : ` I read the finished short back (${how}): ${warnings} ${warnings === 1 ? "thing" : "things"} to look at before approving.`
}

// ffmpeg's silencedetect lines (lavfi.silence_start=12.3 / lavfi.silence_end=14.0, printed by ametadata) as stretches.
export const parseSilences = (output: string, durationS: number): ReadonlyArray<readonly [number, number]> => {
  const out: Array<readonly [number, number]> = []
  let start: number | null = null
  for (const line of output.split("\n")) {
    const m = /lavfi\.silence_(start|end)=(-?[\d.]+)/.exec(line)
    if (m === null) continue
    const t = Number(m[2])
    if (m[1] === "start") start = Math.max(0, t)
    else if (start !== null) {
      out.push([start, t])
      start = null
    }
  }
  if (start !== null) out.push([start, durationS])
  return out
}
