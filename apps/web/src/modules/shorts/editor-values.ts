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

export const narratedWords = (script: Script) =>
  script.beats.reduce((n, beat) => n + (beat._tag === "Narration" ? beat.text.split(/\s+/).filter((w) => /\w/.test(w)).length : 0), 0)
export const realLines = (script: Script) => script.beats.filter((b) => b._tag === "Real").length

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
  readonly narration: ReadonlyArray<TimelineSegment>
  // each real line with the video it's from (the first = 0)
  readonly reals: ReadonlyArray<TimelineSegment & { readonly kind: "insert" | "outro"; readonly source: number }>
  // where the narration ends and the outro clips begin
  readonly outroStart: number
  // where the voiceover pauses for a real line (voiceover seconds), for how long, and the line's video
  readonly pauses: ReadonlyArray<{ readonly at: number; readonly dur: number; readonly source: number }>
}

// A moment of the voiceover in the short's own time: every pause before it has played by then.
export const shortTimeOf = (layout: Pick<TimelineLayout, "pauses">, voiceoverSeconds: number) =>
  voiceoverSeconds + layout.pauses.filter((p) => p.at < voiceoverSeconds).reduce((n, p) => n + p.dur, 0)

// The short on one timeline, as the renderer plays it: the voiceover pauses after the last word of the narration
// before each real line, the line plays, then the voiceover goes on; real lines after the last narration play at
// the end. Everything is in the short's own seconds.
export const layoutTimeline = (script: Script, words: ReadonlyArray<TranscriptWord>, voiceoverSeconds: number): TimelineLayout => {
  const ends = narrationEnds(script, words)
  const lastNarration = script.beats.findLastIndex((b) => b._tag === "Narration")
  const inserts: Array<{ at: number; dur: number; label: string; source: number }> = []
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
    const clip = { dur: Math.max(0, beat.end - beat.start), label: beat.quote, source: beat.source ?? 0 }
    if (i > lastNarration || narrated < 0) outro.push(clip)
    else inserts.push({ ...clip, at: words[ends[narrated] ?? 0]?.e ?? 0 })
  })
  // voiceover time → the short's time: every insert that starts before t has played by then
  const shifted = (t: number) => t + inserts.filter((x) => x.at < t).reduce((n, x) => n + x.dur, 0)
  const reals: Array<TimelineSegment & { readonly kind: "insert" | "outro"; readonly source: number }> = []
  inserts.forEach((x, k) => {
    // back-to-back inserts after the same word follow each other
    const start = x.at + inserts.slice(0, k).reduce((n, y) => n + y.dur, 0)
    reals.push({ start, end: start + x.dur, label: x.label, kind: "insert", source: x.source })
  })
  const outroStart = shifted(voiceoverSeconds) + inserts.filter((x) => x.at >= voiceoverSeconds).reduce((n, x) => n + x.dur, 0)
  let t = outroStart
  for (const clip of outro) {
    reals.push({ start: t, end: t + clip.dur, label: clip.label, kind: "outro", source: clip.source })
    t += clip.dur
  }
  return {
    total: t,
    narration: spans.map((s) => ({ start: shifted(s.from), end: shifted(s.to), label: s.label })),
    reals,
    outroStart,
    pauses: inserts.map((x) => ({ at: x.at, dur: x.dur, source: x.source }))
  }
}

// "1:05" for a time in seconds.
export const clockOf = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// One video's stretch of the finished short: from `start` to `end` in the short's seconds.
export interface SourceStretch {
  readonly start: number
  readonly end: number
}

// Which stretches of the short come from which video, for the timeline's source strip: one list per video (by
// position), pieces that touch (within `gap` seconds) joined into one.
export const sourceStretches = (
  pieces: ReadonlyArray<{ readonly start: number; readonly end: number; readonly source: number }>,
  videos: number,
  gap = 0.05
): ReadonlyArray<ReadonlyArray<SourceStretch>> =>
  Array.from({ length: videos }, (_, v) =>
    [...pieces].filter((p) => p.source === v && p.end > p.start).sort((a, b) => a.start - b.start).reduce<Array<SourceStretch>>((out, p) => {
      const last = out.at(-1)
      if (last !== undefined && p.start <= last.end + gap) out[out.length - 1] = { start: last.start, end: Math.max(last.end, p.end) }
      else out.push({ start: p.start, end: p.end })
      return out
    }, []))

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
