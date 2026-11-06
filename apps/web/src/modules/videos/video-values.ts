import type { AdRange, ContactSheetSet, SourceShort, StageName, StageRun, StoryBeat, ViralityScores } from "@viral/contracts"

// The source run's stages, in order, as the video page words them while they run and once they're done.
export const SOURCE_STAGES: ReadonlyArray<{ readonly stage: StageName; readonly running: string; readonly done: string; readonly sub: string }> = [
  { stage: "source", running: "Getting the video", done: "Got the video", sub: "Copied into your library" },
  { stage: "transcribe", running: "Transcribing every word", done: "Transcribed every word", sub: "With word timings, so real lines can be cut exactly" },
  { stage: "contact-sheet", running: "Looking at the whole video", done: "Looked at the whole video", sub: "A frame every 5 seconds" },
  { stage: "ads", running: "Finding the ads to keep out", done: "Found the ads to keep out", sub: "Sponsor reads, ads and end screens" },
  { stage: "story", running: "Mapping the story and suggesting shorts", done: "Mapped the story and suggested 3 shorts", sub: "Three ways to make a short, scored" }
]

export type StepState = "done" | "running" | "waiting" | "failed" | "next"

// Where a stage stands, from its latest attempt (none yet = next).
export const stepState = (run: StageRun | undefined): StepState => {
  switch (run?.status) {
    case undefined:
    case "skipped":
      return "next"
    case "succeeded":
    case "reused":
      return "done"
    case "running":
      return "running"
    case "waiting":
      return "waiting"
    case "failed":
    case "cancelled":
      return "failed"
  }
}

// "18.5s", "2 min 3s"
export const duration = (ms: number) => {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)}s`
}

// A model id as people say it: "claude-haiku-4-5-20251001" → "Haiku 4.5", "claude-opus-5-5[1m]" → "Opus 5.5".
export const modelName = (model: string) => {
  const match = /claude-(\w+)-(\d+)-(\d+)/.exec(model)
  if (match === null) return model
  return `${match[1]!.charAt(0).toUpperCase()}${match[1]!.slice(1)} ${match[2]}.${match[3]}`
}

// A stage's numbers for Detailed mode: the model, the cost and the time it took.
export const stageDetail = (run: StageRun | undefined) => {
  if (run === undefined) return null
  const parts = [
    run.model === null ? null : modelName(run.model),
    run.costUsd === null ? null : `$${run.costUsd.toFixed(2)}`,
    run.ttsCharacters === null || run.ttsCharacters === 0 ? null : `${run.ttsCharacters} characters`,
    run.durationMs === null ? null : duration(run.durationMs)
  ].filter((part) => part !== null)
  return parts.length === 0 ? null : parts.join(" · ")
}

// The story strip: each beat and each kept-out range as a left offset and width, in percent of the video.
export interface StripPart {
  readonly left: number
  readonly width: number
}
const part = (start: number, end: number, length: number): StripPart => {
  const left = Math.min(100, Math.max(0, (start / length) * 100))
  return { left, width: Math.max(0.4, Math.min(100 - left, ((end - start) / length) * 100)) }
}
export const storyStrip = (beats: ReadonlyArray<StoryBeat>, ads: ReadonlyArray<AdRange>, length: number) =>
  length <= 0
    ? { beats: [], ads: [] }
    : {
      beats: beats.map((b) => ({ beat: b.beat, summary: b.summary, ...part(b.start, b.end, length) })),
      ads: ads.map((a) => ({ kind: a.kind, ...part(a.start, a.end, length) }))
    }

// Ticks under the strip: the start, three quarters, and the end.
export const stripTicks = (length: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => f * length)

// The virality radar's axes, in the words the app uses.
export const SCORE_AXES: ReadonlyArray<{ readonly key: keyof ViralityScores; readonly label: string }> = [
  { key: "openLoop", label: "Open loop" },
  { key: "completionCompulsion", label: "Watch to the end" },
  { key: "universalRelatability", label: "Relatable" },
  { key: "shareability", label: "Shareable" }
]

// A frame for each proposal's card: a still from the middle of a different part of the story, so the three
// cards don't all show the same moment.
export const proposalStillTime = (beats: ReadonlyArray<StoryBeat>, index: number, length: number) => {
  if (beats.length === 0) return length * (0.3 + index * 0.25)
  const beat = beats[Math.min(beats.length - 1, Math.floor(((index + 0.5) * beats.length) / 3))]!
  return (beat.start + beat.end) / 2
}

// The still nearest a time.
export const nearestStill = <S extends { readonly t: number }>(stills: ReadonlyArray<S>, t: number): S | null =>
  stills.reduce<S | null>((best, s) => best === null || Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best, null)

// The rights choice on New source, in plain words.
export const RIGHTS_CHOICES = [
  { value: "owned", title: "I made it", sub: "No credit line. Post it anywhere." },
  { value: "licensed", title: "I have permission", sub: "Credits the creator: \"Video: <channel>\"." },
  { value: "unconfirmed", title: "Not sure yet", sub: "Credits the creator and reminds you before you post." }
] as const

// A YouTube, TikTok, Instagram or direct link; anything else isn't a video link.
export const isVideoLink = (text: string) => /^https?:\/\/\S+\.\S+/.test(text.trim())

// The story's first sentence: the page's one-line description.
export const firstSentence = (text: string) => text.split(/(?<=[.!?])\s+/)[0]?.trim() ?? text

// A frame of the video: its time, and either its own image or a tile of a contact sheet (sheets made before
// single frames were kept), placed by column and row.
export interface FrameView {
  readonly t: number
  readonly file: string
  readonly tile: { readonly col: number; readonly row: number; readonly cols: number; readonly rows: number } | null
}

// Every frame of a contact-sheet set: its own files when it has them, otherwise each sheet's tiles.
export const framesOf = (set: ContactSheetSet): ReadonlyArray<FrameView> => {
  if (set.stills !== undefined && set.stills.length > 0) return set.stills.map((s) => ({ t: s.t, file: s.file, tile: null }))
  return set.sheets.flatMap((sheet) => {
    const count = Math.round((sheet.end - sheet.start) / set.every) + 1
    const rows = Math.ceil(count / set.cols)
    return Array.from({ length: count }, (_, k) => ({
      t: sheet.start + k * set.every,
      file: sheet.file,
      tile: { col: k % set.cols, row: Math.floor(k / set.cols), cols: set.cols, rows }
    }))
  })
}

// The short made from a proposal: the one with its exact title first, else any made from it.
export const shortForProposal = (shorts: ReadonlyArray<SourceShort>, index: number, title: string) => {
  const made = shorts.filter((s) => s.proposal === index)
  return made.find((s) => s.project.title === title) ?? made[0] ?? null
}

// The source run so far: what it has cost, by model.
export const runSpend = (stages: ReadonlyArray<StageRun>) => {
  const byModel = new Map<string, number>()
  for (const stage of stages) {
    if (stage.costUsd === null || stage.costUsd === 0) continue
    const name = stage.model === null ? "other" : modelName(stage.model)
    byModel.set(name, (byModel.get(name) ?? 0) + stage.costUsd)
  }
  const total = [...byModel.values()].reduce((a, b) => a + b, 0)
  return { total, split: [...byModel.entries()].map(([name, usd]) => `${name} $${usd.toFixed(2)}`).join(" · ") }
}
