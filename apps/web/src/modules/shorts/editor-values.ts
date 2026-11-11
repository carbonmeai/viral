import type { ProjectFormat, RunRequest, Script, StageName, StageRun, TranscriptWord } from "@viral/contracts"

// The editor's steps. A step can cover more than one stage: Render is assemble then render; Publish is metadata.
// Music is the bed assemble fits (narrated shorts only; a cut-down short has no bed, so no Music step).
// A ranking's first step is its moments, shown as "Ranking".
export type EditorStepId = "script" | "sections" | "moments" | "voice" | "shots" | "music" | "render" | "publish" | "thumbnail"
export const EDITOR_STEP_IDS: ReadonlyArray<EditorStepId> = ["script", "sections", "moments", "voice", "shots", "music", "render", "publish", "thumbnail"]
export interface EditorStep {
  readonly id: EditorStepId
  readonly name: string
  readonly stages: ReadonlyArray<StageName>
}

const NARRATED: ReadonlyArray<EditorStep> = [
  { id: "script", name: "Script", stages: ["script"] },
  { id: "voice", name: "Voice", stages: ["voice"] },
  { id: "shots", name: "Shots", stages: ["shots"] },
  { id: "music", name: "Music", stages: ["assemble"] },
  { id: "render", name: "Render", stages: ["assemble", "render"] },
  { id: "publish", name: "Publish", stages: ["metadata"] },
  { id: "thumbnail", name: "Thumbnail", stages: ["thumbnail"] }
]
const CUT_DOWN: ReadonlyArray<EditorStep> = [
  { id: "sections", name: "Sections", stages: ["sections"] },
  { id: "render", name: "Render", stages: ["assemble", "render"] },
  { id: "publish", name: "Publish", stages: ["metadata"] },
  { id: "thumbnail", name: "Thumbnail", stages: ["thumbnail"] }
]

const RANKING: ReadonlyArray<EditorStep> = [
  { id: "moments", name: "Ranking", stages: ["moments"] },
  { id: "render", name: "Render", stages: ["assemble", "render"] },
  { id: "publish", name: "Publish", stages: ["metadata"] },
  { id: "thumbnail", name: "Thumbnail", stages: ["thumbnail"] }
]

export const editorSteps = (format: ProjectFormat): ReadonlyArray<EditorStep> =>
  format === "cut-down" ? CUT_DOWN : format === "ranking" ? RANKING : NARRATED

export type EditorStepState = "done" | "waiting" | "running" | "failed" | "next"

// The latest attempt of each stage.
const latestByStage = (stages: ReadonlyArray<StageRun>) => {
  const byStage = new Map<StageName, StageRun>()
  for (const stage of stages) {
    const seen = byStage.get(stage.stage)
    if (seen === undefined || stage.attempt >= seen.attempt) byStage.set(stage.stage, stage)
  }
  return byStage
}

// Where each step stands: waiting or running if any of its stages is; done once all of them are; failed when its
// latest attempt stopped; otherwise next.
export const stepStates = (steps: ReadonlyArray<EditorStep>, stages: ReadonlyArray<StageRun>): ReadonlyMap<EditorStepId, EditorStepState> => {
  const latest = latestByStage(stages)
  return new Map(steps.map((step) => {
    const runs = step.stages.map((s) => latest.get(s))
    const has = (...statuses: ReadonlyArray<StageRun["status"]>) => runs.some((r) => r !== undefined && statuses.includes(r.status))
    const state: EditorStepState = has("waiting")
      ? "waiting"
      : has("running")
      ? "running"
      : runs.every((r) => r !== undefined && (r.status === "succeeded" || r.status === "reused"))
      ? "done"
      : has("failed", "cancelled")
      ? "failed"
      : "next"
    return [step.id, state]
  }))
}

// The step the editor opens on: the one waiting for you, else the first that isn't done, else the last.
export const openingStep = (steps: ReadonlyArray<EditorStep>, states: ReadonlyMap<EditorStepId, EditorStepState>): EditorStepId =>
  steps.find((s) => states.get(s.id) === "waiting")?.id ??
    steps.find((s) => states.get(s.id) !== "done")?.id ??
    steps[steps.length - 1]!.id

// The editor step that shows a stage (assemble and render are Render; metadata is Publish),
// or undefined for a stage that isn't a short's.
const STEP_OF_STAGE: Partial<Record<string, EditorStepId>> = {
  script: "script",
  sections: "sections",
  moments: "moments",
  voice: "voice",
  shots: "shots",
  assemble: "render",
  render: "render",
  metadata: "publish",
  thumbnail: "thumbnail"
}
export const stepOfStage = (stage: StageName): EditorStepId | undefined => STEP_OF_STAGE[stage]

// The step a waiting gate belongs to.
export const stepOfRequest = (steps: ReadonlyArray<EditorStep>, request: RunRequest | null) =>
  request === null ? null : steps.find((s) => s.stages.includes(request.stage))?.id ?? null

const normalize = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
// how a script line splits into the words a transcriber hears ("spicy-cold" is two)
const tokens = (text: string) => text.split(/[\s\-–—]+/).map(normalize).filter((t) => t !== "")

// The narrated words that play (a skipped line is voiced, but the short jumps over it), as the server counts them.
export const narratedWords = (script: Script) =>
  script.beats.reduce((n, beat) =>
    n + (beat._tag === "Narration" && beat.skipped !== true ? beat.text.split(/\s+/).filter((w) => /\w/.test(w)).length : 0), 0)
export const realLines = (script: Script) => script.beats.filter((b) => b._tag === "Real").length
// How long the real take that ends the script plays (0 when it ends on narration): the payoff of a story recap.
export const payoffSeconds = (script: Script) => {
  // the closing question comes after the payoff, so it's skipped
  const last = script.beats.filter((b) => b._tag !== "Cta").at(-1)
  return last?._tag === "Real" ? Math.max(0, last.end - last.start) : 0
}

// How many real lines come from each of the short's videos, by position (the first one first).
export const realsByVideo = (script: Script, videos: number) =>
  Array.from({ length: videos }, (_, i) => script.beats.filter((b) => b._tag === "Real" && (b.source ?? 0) === i).length)

// Where each narration beat's voiceover words end: the expected count, corrected to the nearest word that
// matches the beat's last word (the server places real lines the same way).
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
      const hit = [expected - d, expected + d].filter((i) => i >= next && i < words.length).find((i) => normalize(words[i]!.w) === last)
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

export interface TimelineSegment {
  readonly start: number
  readonly end: number
  readonly label: string
}
export interface TimelineLayout {
  // the short's length: the voiceover with the real lines played in, then the outro
  readonly total: number
  // each narration line on the short's clock, and where it is in the voiceover (`from`, `to`: voiceover seconds)
  readonly narration: ReadonlyArray<TimelineSegment & { readonly from: number; readonly to: number }>
  // each real line with the video it's from (the first = 0)
  readonly reals: ReadonlyArray<TimelineSegment & { readonly kind: "insert" | "outro"; readonly source: number }>
  // where the narration ends and the outro clips begin
  readonly outroStart: number
  // where the voiceover pauses for a real line (voiceover seconds), for how long, and the line's video; with `skip`, it
  // picks up that many seconds later, jumping over a line the real line says anyway
  readonly pauses: ReadonlyArray<Pause>
  // the closing question (the script's Cta beat): its line in the voiceover (`from`, `to`), cut out of the narration;
  // with the style's end card, where the card plays on the short's clock (`start`, `end`, after the outro); null when
  // the script has none
  readonly closing: (TimelineSegment & { readonly from: number; readonly to: number; readonly card: boolean }) | null
}

// The end card's timing, as end_card.py plays it: the short holds its last frame while the card fades in (0.35 s), the
// narrator's closing line, then 0.6 s of air. A cut-down short's card holds 3 s, silent.
export const END_CARD_LEAD = 0.35
export const END_CARD_TAIL = 0.6
export const CUT_END_CARD_SECONDS = 3

export interface Pause {
  readonly at: number
  readonly dur: number
  readonly source: number
  readonly skip?: number
}

// A moment of the voiceover in the short's own time: every pause before it has played by then (and every skipped
// stretch before it is gone). A moment inside a skipped stretch never plays: it lands where the narration picks up.
export const shortTimeOf = (layout: { readonly pauses: ReadonlyArray<Pick<Pause, "at" | "dur" | "skip">> }, voiceoverSeconds: number) => {
  let offset = 0
  for (const p of [...layout.pauses].sort((a, b) => a.at - b.at)) {
    if (voiceoverSeconds <= p.at) break
    const skip = p.skip ?? 0
    if (voiceoverSeconds < p.at + skip) return p.at + offset + p.dur
    offset += p.dur - skip
  }
  return voiceoverSeconds + offset
}

// Whether a moment of the voiceover is in a stretch the short skips.
export const skippedAt = (layout: { readonly pauses: ReadonlyArray<Pick<Pause, "at" | "skip">> }, voiceoverSeconds: number) =>
  layout.pauses.some((p) => (p.skip ?? 0) > 0 && voiceoverSeconds > p.at && voiceoverSeconds < p.at + p.skip!)

// With a style's soft joins, the narrator breathes after the word before a clip: 0.25 s, at most half way to the next word.
export const INSERT_PAD = 0.25
// The narration picks up just before the word after a skipped line, as the renderer does.
const RESUME_LEAD = 0.08

// The short on one timeline, as the renderer plays it: the voiceover pauses after the last word of the narration
// before each real line, the line plays, then the voiceover goes on; real lines after the last narration play at
// the end. Everything is in the short's own seconds.
export const layoutTimeline = (
  script: Script,
  words: ReadonlyArray<TranscriptWord>,
  takeSeconds: number,
  options: { readonly softJoins?: boolean; readonly endCard?: boolean } = {}
): TimelineLayout => {
  const ends = narrationEnds(script, words)
  // the closing question's line is the take's last words; the story's narration ends just before it (as assemble cuts it)
  const question = script.beats.at(-1)?._tag === "Cta" ? (script.beats.at(-1) as { readonly question: string }).question : null
  const closingFirst = question === null ? null : (ends.at(-1) ?? -1) + 1
  const closingLine = closingFirst === null || closingFirst <= 0 || words[closingFirst] === undefined
    ? null
    : { from: Math.max(words[closingFirst - 1]!.e, words[closingFirst]!.s - 0.12), to: words.at(-1)!.e }
  // the story's part of the take
  const voiceoverSeconds = closingLine === null ? takeSeconds : closingLine.from
  const lastNarration = script.beats.findLastIndex((b) => b._tag === "Narration")
  const inserts: Array<{ at: number; dur: number; label: string; source: number; skip: number }> = []
  const outro: Array<{ dur: number; label: string; source: number }> = []
  const spans: Array<{ from: number; to: number; label: string }> = []
  let narrated = -1
  let firstWord = 0
  script.beats.forEach((beat, i) => {
    if (beat._tag === "Narration") {
      narrated++
      const end = ends[narrated] ?? firstWord
      const from = words[firstWord]?.s ?? 0
      const to = words[end]?.e ?? from
      spans.push({ from, to, label: beat.text })
      firstWord = end + 1
      return
    }
    if (beat._tag === "Cta") return
    const clip = { dur: Math.max(0, beat.end - beat.start), label: beat.quote, source: beat.source ?? 0 }
    if (i > lastNarration || narrated < 0) {
      outro.push(clip)
      return
    }
    const after = ends[narrated] ?? 0
    const wordEnd = words[after]?.e ?? 0
    const next = words[after + 1]?.s ?? voiceoverSeconds
    const at = options.softJoins === true ? Math.min(wordEnd + INSERT_PAD, (wordEnd + next) / 2) : wordEnd
    // a skipped line next: the narration picks up at the word after it
    const following = script.beats[i + 1]
    const resumeWord = following?._tag === "Narration" && following.skipped === true ? (ends[narrated + 1] ?? after) + 1 : null
    const resume = resumeWord === null || words[resumeWord] === undefined ? at : Math.max(at, words[resumeWord]!.s - RESUME_LEAD)
    inserts.push({ ...clip, at, skip: resume - at })
  })
  // voiceover time → the short's time: every insert that starts before t has played by then
  const shifted = (t: number) => shortTimeOf({ pauses: inserts }, t)
  const reals: Array<TimelineSegment & { readonly kind: "insert" | "outro"; readonly source: number }> = []
  inserts.forEach((x, k) => {
    // back-to-back inserts after the same word follow each other
    const start = x.at + inserts.slice(0, k).reduce((n, y) => n + y.dur - y.skip, 0)
    reals.push({ start, end: start + x.dur, label: x.label, kind: "insert", source: x.source })
  })
  const outroStart = shifted(voiceoverSeconds) + inserts.filter((x) => x.at >= voiceoverSeconds).reduce((n, x) => n + x.dur, 0)
  let t = outroStart
  for (const clip of outro) {
    reals.push({ start: t, end: t + clip.dur, label: clip.label, kind: "outro", source: clip.source })
    t += clip.dur
  }
  const card = options.endCard === true && closingLine !== null
  const closing = closingLine === null || question === null ? null : {
    start: t,
    end: card ? t + END_CARD_LEAD + (Math.min(takeSeconds, closingLine.to + 0.3) - closingLine.from) + END_CARD_TAIL : t,
    label: question,
    from: closingLine.from,
    to: closingLine.to,
    card
  }
  return {
    total: closing?.end ?? t,
    closing,
    narration: spans.map((s) => ({ start: shifted(s.from), end: shifted(s.to), label: s.label, from: s.from, to: s.to })),
    reals,
    outroStart,
    pauses: inserts.map((x) => ({ at: x.at, dur: x.dur, source: x.source, ...(x.skip > 0 ? { skip: x.skip } : {}) }))
  }
}

// "1:05" for a time in seconds.
export const clockOf = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// The live run's stage runs, with what the last workspace load knows that the live events don't yet: a stage
// reports its cost as it goes but its row only arrives again when it finishes, so an attempt waiting at its gate
// would show no cost. Costs only grow, so a live value wins once there is one.
export const withStoredCosts = (live: ReadonlyArray<StageRun>, stored: ReadonlyArray<StageRun>): ReadonlyArray<StageRun> =>
  live.map((run) => {
    const known = stored.find((s) => s.id === run.id)
    return known === undefined ? run : {
      ...run,
      model: run.model ?? known.model,
      provider: run.provider ?? known.provider,
      billing: run.billing ?? known.billing,
      costUsd: run.costUsd ?? known.costUsd,
      ttsCharacters: run.ttsCharacters ?? known.ttsCharacters
    }
  })

// What a step spent in this run: its total, and each try's (a try is an attempt number across the step's stages, so
// the Render step's assemble + render once is one try).
export interface StepSpend {
  readonly costUsd: number
  readonly tries: ReadonlyArray<number>
  readonly characters: number
}
export const stepSpend = (stages: ReadonlyArray<StageRun>, names: ReadonlyArray<StageName>): StepSpend => {
  const runs = stages.filter((s) => names.includes(s.stage))
  const cost = (rs: ReadonlyArray<StageRun>) => rs.reduce((n, s) => n + (s.costUsd ?? 0), 0)
  const attempts = [...new Set(runs.map((r) => r.attempt))].sort((a, b) => a - b)
  return {
    costUsd: cost(runs),
    tries: attempts.map((a) => cost(runs.filter((r) => r.attempt === a))),
    characters: runs.reduce((n, s) => n + (s.ttsCharacters ?? 0), 0)
  }
}

const usd = (n: number) => `$${n.toFixed(2)}`
// "$0.57 · 2 tries ($0.17, $0.40)", or "$0.17" for one try; null when it cost nothing
export const spendText = (spend: StepSpend) =>
  spend.costUsd <= 0 ? null : spend.tries.length > 1
    ? `${usd(spend.costUsd)} · ${spend.tries.length} tries (${spend.tries.map(usd).join(", ")})`
    : usd(spend.costUsd)

// ---- The editor's frame: the rail, which panel a step opens, and the top bar's buttons ----

// The panels the rail opens, plus the two a step opens without a rail item of its own (Publish → Post,
// Thumbnail → its panel).
export type PanelId = "library" | "script" | "ranks" | "sections" | "captions" | "voice" | "music" | "style" | "post" | "thumbnail"

export interface RailItem {
  readonly id: PanelId
  readonly label: string
}

// The rail, by format: a narrated short has its script, voice and music; a ranking its ranks and titles (and the
// Music panel, which says why a ranking has none); a cut-down short its sections. Captions are a ranking's Titles.
export const railFor = (format: ProjectFormat): ReadonlyArray<RailItem> =>
  format === "ranking"
    ? [{ id: "library", label: "Library" }, { id: "ranks", label: "Ranks" }, { id: "captions", label: "Titles" }, { id: "music", label: "Music" }, { id: "style", label: "Style" }]
    : format === "cut-down"
    ? [{ id: "library", label: "Library" }, { id: "sections", label: "Sections" }, { id: "captions", label: "Captions" }, { id: "style", label: "Style" }]
    : [
      { id: "library", label: "Library" },
      { id: "script", label: "Script" },
      { id: "captions", label: "Captions" },
      { id: "voice", label: "Voice" },
      { id: "music", label: "Music" },
      { id: "style", label: "Style" }
    ]

// The panel that holds a step's work: Shots and Render live in the Library (its frames, this short's files).
const PANEL_OF_STEP: Record<EditorStepId, PanelId> = {
  script: "script",
  sections: "sections",
  moments: "ranks",
  voice: "voice",
  shots: "library",
  music: "music",
  render: "library",
  publish: "post",
  thumbnail: "thumbnail"
}
export const panelForStep = (step: EditorStepId): PanelId => PANEL_OF_STEP[step]

// The rail item that gets a dot: where the step waiting for you lives, unless that panel is open already.
export const railDot = (format: ProjectFormat, waiting: EditorStepId | null, panel: PanelId): PanelId | null => {
  if (waiting === null) return null
  const id = panelForStep(waiting)
  return id !== panel && railFor(format).some((r) => r.id === id) ? id : null
}

// What the waiting bar above the player asks you to check, per step.
const CHECK: Record<EditorStepId, string> = {
  script: "The script is ready to check",
  sections: "Check the sections",
  moments: "Check the ranking",
  voice: "Listen to the voice take",
  shots: "Check the shots",
  music: "Check where the drop lands",
  render: "Watch the render",
  publish: "Pick the title and post text",
  thumbnail: "Check the thumbnail"
}
export const whatToCheck = (step: EditorStepId) => CHECK[step]

export interface PrimaryButtons {
  // the waiting step's Approve ("Approve script"), the primary while a step waits
  readonly approve: string | null
  readonly publish: {
    readonly label: "Publish" | "Publish again"
    readonly enabled: boolean
    // the lemon primary: only when nothing waits
    readonly primary: boolean
    // why it can't be used yet
    readonly reason: string | null
  }
}

// The top bar's buttons: while a step waits, its Approve is the primary and Publish sits next to it; Publish needs a
// render first (it says why until then), and reads "Publish again" when the published files are out of date.
export const primaryButtons = ({ waiting, rendered, outOfDate }: {
  // the waiting step's name, or null
  readonly waiting: string | null
  readonly rendered: boolean
  readonly outOfDate: boolean
}): PrimaryButtons => ({
  approve: waiting === null ? null : `Approve ${waiting.toLowerCase()}`,
  publish: {
    label: rendered && outOfDate ? "Publish again" : "Publish",
    enabled: rendered,
    primary: waiting === null,
    reason: rendered ? null : "Publish opens once the short is rendered."
  }
})
