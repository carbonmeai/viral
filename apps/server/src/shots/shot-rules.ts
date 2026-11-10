import type { ProposedShots, Script, ShotInsert, ShotPlan, ShotProposal, SourceIndex, TranscriptWord } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"
import { clipSource, type SourceContext, sourceField, sourceLabel } from "../projects/source-context.ts"

export type Range = { readonly start: number; readonly end: number }

// A shot plan before its frames are drawn.
export type ShotDraft = {
  readonly [K in "shots" | "inserts" | "outro"]: ReadonlyArray<Omit<ShotPlan[K][number], "frame">>
} & Pick<ShotPlan, "markers" | "highlights">

// A shot longer than this drags; the styles cut every 1–2s.
export const MAX_SHOT_SECONDS = 3
const SPEED: readonly [number, number] = [0.5, 4]
const LABEL_WORDS = 3
const HIGHLIGHTS = 12

const normalize = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
// how a script line splits into the words a transcriber hears ("spicy-cold" is two)
const tokens = (text: string) => text.split(/[\s\-–—]+/).map(normalize).filter((t) => t !== "")

// Where the voiceover's words for each narration beat end: the expected count, corrected to the nearest
// voiceover word that matches the beat's last word (transcribers split and join words differently).
export const narrationEnds = (script: Script, words: ReadonlyArray<TranscriptWord>): ReadonlyArray<number> => {
  const ends: Array<number> = []
  let next = 0
  for (const beat of script.beats) {
    if (beat._tag !== "Narration") continue
    const beatTokens = tokens(beat.text)
    const last = beatTokens.at(-1) ?? ""
    const expected = Math.min(words.length - 1, next + beatTokens.length - 1)
    let found = expected
    for (let d = 0; d <= 4; d++) {
      const candidates = [expected - d, expected + d].filter((i) => i >= next && i < words.length)
      const hit = candidates.find((i) => normalize(words[i]!.w) === last)
      if (hit !== undefined) {
        found = hit
        break
      }
    }
    ends.push(found)
    next = found + 1
  }
  return ends
}

// The script's real lines on the voiceover: a line after the last narration is an outro clip; any other
// plays as an insert after the last voiceover word of the narration before it. When the line after an insert is
// skipped (the clip says it), the narration resumes at the first word after that line.
export const placeReals = (script: Script, words: ReadonlyArray<TranscriptWord>): Pick<ShotDraft, "inserts" | "outro"> => {
  const ends = narrationEnds(script, words)
  const lastNarration = script.beats.findLastIndex((b) => b._tag === "Narration")
  const inserts: Array<ShotInsert> = []
  const outro: Array<ShotDraft["outro"][number]> = []
  let narrated = -1
  script.beats.forEach((beat, i) => {
    if (beat._tag === "Narration") {
      narrated++
      return
    }
    // the closing question is narration after the story, played under the end card
    if (beat._tag === "Cta") return
    const clip = { start: beat.start, end: beat.end, quote: beat.quote, ...sourceField(beat.source) }
    if (i > lastNarration || narrated < 0) {
      outro.push(clip)
      return
    }
    const afterWord = ends[narrated]!
    const next = script.beats[i + 1]
    const resumeWord = next?._tag === "Narration" && next.skipped === true ? ends[narrated + 1]! + 1 : null
    inserts.push({
      ...clip,
      afterWord,
      afterWordText: words[afterWord]?.w ?? "",
      ...(resumeWord === null || resumeWord >= words.length ? {} : { resumeWord, resumeWordText: words[resumeWord]!.w })
    })
  })
  return { inserts, outro }
}

// The closing question's first voiceover word: the take says it after the last narrated line. null when the script has
// no closing question (or the take ends before it).
export const closingWord = (script: Script, words: ReadonlyArray<TranscriptWord>): number | null => {
  if (script.beats.at(-1)?._tag !== "Cta") return null
  const first = (narrationEnds(script, words).at(-1) ?? -1) + 1
  return first > 0 && first < words.length ? first : null
}

// Where the story's narration ends in the take: just before the closing question (0.12 s before its first word, never
// into the last narrated word), or the take's end when there's none. The shots run to here; the closing line plays
// under the end card.
export const narrationEndOf = (script: Script, words: ReadonlyArray<TranscriptWord>, takeSeconds: number): number => {
  const first = closingWord(script, words)
  if (first === null) return takeSeconds
  const before = words[first - 1]!.e
  const start = words[first]!.s
  return Math.round(Math.max(before, start - 0.12) * 1000) / 1000
}

// The take as the shots see it: the story's words and length, without the closing question.
export const storyTake = (script: Script, words: ReadonlyArray<TranscriptWord>, takeSeconds: number) => {
  const first = closingWord(script, words)
  return { words: first === null ? words : words.slice(0, first), seconds: narrationEndOf(script, words, takeSeconds) }
}

// The voiceover word the narration picks up from after an insert.
export const resumeOf = (insert: Pick<ShotInsert, "afterWord" | "resumeWord">) => insert.resumeWord ?? insert.afterWord + 1

// What the agent sent as a ShotProposal: each shot's V number becomes its position (V2 → source 1; V1 left out).
// A V number the short doesn't have is kept as a position, for checkShots to name.
export const fromProposedShots = (proposed: ProposedShots): ShotProposal => ({
  ...proposed,
  shots: proposed.shots.map(({ video, ...shot }) => ({
    ...shot,
    ...sourceField(video === undefined ? undefined : (video - 1) as SourceIndex)
  }))
})

export interface ShotContext {
  readonly words: ReadonlyArray<TranscriptWord>
  // the voiceover's length; the last shot runs to it
  readonly voiceoverSeconds: number
  // the short's videos, V1 first: each shot plays from its own
  readonly sources: ReadonlyArray<Pick<SourceContext, "seconds" | "excluded">>
  readonly inserts: ReadonlyArray<ShotInsert>
}

const fmt = (t: number) => t.toFixed(1)

// Checks a proposed shot list against the voiceover and the short's videos, and fills in each anchor's word text.
export const checkShots = (proposal: ShotProposal, ctx: ShotContext): Checked<Pick<ShotDraft, "shots" | "markers" | "highlights">> => {
  const problems: Array<string> = []
  const { words } = ctx
  const wordAt = (i: number) => words[i]?.w ?? ""
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < words.length

  if (proposal.shots.length === 0) problems.push("there are no shots")
  if (proposal.shots[0] !== undefined && proposal.shots[0].word !== 0) problems.push("the first shot must start on word 0")
  const starts = new Set(proposal.shots.map((s) => s.word))

  proposal.shots.forEach((shot, k) => {
    const name = `shot ${k + 1} (word ${shot.word} "${wordAt(shot.word)}"${ctx.sources.length > 1 ? `, ${sourceLabel(shot.source ?? 0)}` : ""})`
    if (!valid(shot.word)) return problems.push(`shot ${k + 1}: word ${shot.word} isn't in the voiceover (0–${words.length - 1})`)
    const next = proposal.shots[k + 1]
    if (next !== undefined && next.word <= shot.word) problems.push(`${name}: the next shot must start on a later word`)
    const from = shot.word === 0 ? 0 : words[shot.word]!.s
    const until = next !== undefined && valid(next.word) ? words[next.word]!.s : ctx.voiceoverSeconds
    // a shot runs until the narration pauses for a clip that skips the line after it, not through the skipped words
    const pause = ctx.inserts.find((x) => x.resumeWord !== undefined && x.afterWord >= shot.word && words[x.afterWord] !== undefined && words[x.afterWord]!.e < until)
    const to = pause === undefined ? until : words[pause.afterWord]!.e
    const length = to - from
    if (length > MAX_SHOT_SECONDS) {
      problems.push(`${name} lasts ${fmt(length)}s; cut to a new shot within ${MAX_SHOT_SECONDS}s`)
    }
    const speed = shot.speed ?? 1
    if (speed < SPEED[0] || speed > SPEED[1]) problems.push(`${name}: speed ${speed} is outside ${SPEED[0]}–${SPEED[1]}`)
    if (shot.cropX !== undefined && (shot.cropX < 0 || shot.cropX > 1)) problems.push(`${name}: cropX must be 0–1`)
    const video = clipSource(ctx.sources, shot.source, name)
    if (video.problem !== null) return problems.push(video.problem)
    const { seconds, excluded } = video.source
    // the footage is cut for the whole stretch of voiceover, skipped words included
    const srcEnd = shot.src + Math.max(0, until - from) * speed
    if (shot.src < 0 || srcEnd > seconds) {
      problems.push(`${name} plays ${fmt(shot.src)}–${fmt(srcEnd)}s, outside the video (0–${fmt(seconds)}s)`)
    }
    const ad = excluded.find((r) => shot.src < r.end && srcEnd > r.start)
    if (ad !== undefined) {
      problems.push(`${name} plays ${fmt(shot.src)}–${fmt(srcEnd)}s, inside an excluded range (${fmt(ad.start)}–${fmt(ad.end)}s)`)
    }
  })

  for (const shot of proposal.shots) {
    const over = ctx.inserts.find((x) => x.resumeWord !== undefined && shot.word > x.afterWord && shot.word < x.resumeWord)
    if (over !== undefined) {
      problems.push(`shot on word ${shot.word} "${wordAt(shot.word)}" is in narration the short skips after "${over.quote}"; start it on word ${over.resumeWord} or later`)
    }
  }
  for (const insert of ctx.inserts) {
    const resume = resumeOf(insert)
    if (resume < words.length && !starts.has(resume)) {
      problems.push(`start a new shot on word ${resume} "${wordAt(resume)}", where the narration resumes after "${insert.quote}"`)
    }
  }

  proposal.markers.forEach((marker, k) => {
    const name = `marker ${k + 1} (${marker._tag})`
    if (!valid(marker.word)) problems.push(`${name}: word ${marker.word} isn't in the voiceover`)
    if (marker.x < 0 || marker.x > 1 || marker.y < 0 || marker.y > 1) problems.push(`${name}: x and y are fractions of the frame, 0–1`)
    if (marker._tag === "Label" && marker.text.split(/\s+/).length > LABEL_WORDS) {
      problems.push(`${name}: "${marker.text}" is too long; labels are one to ${LABEL_WORDS} words`)
    }
  })

  const highlights = proposal.highlights ?? []
  if (highlights.length > HIGHLIGHTS) problems.push(`highlight at most ${HIGHLIGHTS} words; ${highlights.length} dilutes them`)
  const spoken = new Set(words.map((w) => normalize(w.w)))
  for (const highlight of highlights) {
    const word = typeof highlight === "string" ? highlight : highlight.word
    if (!spoken.has(normalize(word))) problems.push(`highlight "${word}" isn't a word of the voiceover`)
  }

  return {
    value: {
      shots: proposal.shots.map(({ source, ...s }) => ({ ...s, ...sourceField(source), wordText: wordAt(s.word) })),
      markers: proposal.markers,
      highlights: highlights.map((h) => typeof h === "string" ? normalize(h) : { word: normalize(h.word), color: h.color })
    },
    problems
  }
}
