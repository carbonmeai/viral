import { closingLine } from "@viral/contracts"
import type { CaptionCue } from "./caption-cues.ts"
import { CUT_END_CARD_SECONDS, END_CARD_LEAD, type TimelineLayout } from "./editor-values.ts"
import { ROLE_NAMES, type RankingDraft, entryBlocks } from "./ranking/ranking-values.ts"
import { BEATS, type EditSection, sectionBlocks } from "./sections/sections-values.ts"
import type { ShotBlock } from "./shots/shots-values.ts"

// ---- The short's timeline as lanes: one per video, then its sound, captions and music ----

// What clicking a clip selects: a shot, a real line (its script beat), a narration line (its beat), a music part (its
// index in the arrangement, null for an automatic bed), a cut-down's section, a ranking's entry (and which of its
// shots), or a caption.
export type ClipTarget =
  | { readonly _tag: "Shot"; readonly k: number }
  | { readonly _tag: "Real"; readonly beat: number }
  | { readonly _tag: "Narration"; readonly beat: number }
  | { readonly _tag: "Music"; readonly index: number | null }
  | { readonly _tag: "Section"; readonly k: number }
  | { readonly _tag: "Entry"; readonly rank: number; readonly shot: number | null }
  | { readonly _tag: "Caption"; readonly index: number }

export const sameTarget = (a: ClipTarget | null, b: ClipTarget | null): boolean => {
  if (a === null || b === null || a._tag !== b._tag) return false
  switch (a._tag) {
    case "Shot":
    case "Section":
      return a.k === (b as typeof a).k
    case "Real":
    case "Narration":
      return a.beat === (b as typeof a).beat
    case "Music":
      return a.index === (b as typeof a).index
    case "Entry":
      // an entry is selected with any of its shots
      return a.rank === (b as typeof a).rank
    case "Caption":
      return a.index === (b as typeof a).index
  }
}

// A stretch of an audio file (its own seconds) drawn as the clip's waveform.
export interface ClipWave {
  readonly url: string
  readonly from: number
  readonly to: number
}

// One block on a lane, from `start` to `end` on the short's clock.
export interface Clip {
  readonly id: string
  readonly start: number
  readonly end: number
  readonly label: string
  // the hover text, when it says more than the label
  readonly title: string
  // the block's colour (a CSS colour or variable)
  readonly color: string
  // a still, tiled across the block
  readonly frame: string | null
  readonly wave: ClipWave | null
  readonly target: ClipTarget
}

export type TrackKind = "video" | "entries" | "voice" | "sound" | "music" | "captions"

export interface Track {
  // stable per viewer: "video:<source id>", "voice", "music"…
  readonly id: string
  readonly kind: TrackKind
  readonly label: string
  // a video lane's video, by position (its colour dot)
  readonly video: number | null
  readonly clips: ReadonlyArray<Clip>
  // a plain line on an empty stretch of the lane ("No music · voice only"), from `noteSpan` (else the whole lane)
  readonly note: string | null
  readonly noteSpan: { readonly start: number; readonly end: number } | null
  // a marker with a label, e.g. the drop
  readonly marks: ReadonlyArray<{ readonly at: number; readonly label: string }>
  // pinned under the video lanes (they scroll; these don't)
  readonly pinned: boolean
}

export interface ShortTimeline {
  readonly total: number
  readonly tracks: ReadonlyArray<Track>
  // shown instead of lanes until there's something to lay out
  readonly empty: string | null
}

// One of the short's videos, by position: its id (for remembering a hidden lane) and its name.
export interface TrackVideo {
  readonly id: string
  readonly name: string
  readonly title: string | null
  readonly color: string
}

// The captions lane's cues, and where they come from: the render's .srt, or worked out from the words.
export interface TimelineCaptions {
  readonly cues: ReadonlyArray<CaptionCue>
  readonly from: "render" | "words"
}

interface Common {
  readonly videos: ReadonlyArray<TrackVideo>
  // null: the style shows no captions
  readonly captions: TimelineCaptions | null
}

export interface NarratedTracks extends Common {
  readonly format: "narrated"
  readonly layout: TimelineLayout | null
  // the script's beats in order, to tell which line each narration and real-line block is
  readonly beats: ReadonlyArray<{ readonly _tag: "Narration" | "Real" | "Cta" }>
  readonly shots: {
    readonly blocks: ReadonlyArray<ShotBlock>
    readonly sourceOf: (k: number) => number
    readonly frameOf: (k: number) => string | null
  } | null
  readonly realFrame: (kind: "insert" | "outro", index: number) => string | null
  readonly voiceUrl: string | null
  readonly music:
    | { readonly _tag: "None" }
    | { readonly _tag: "NotFitted" }
    | {
      readonly _tag: "Bed"
      readonly url: string | null
      readonly song: string
      // the arrangement's parts (with their index), else the automatic bed's
      readonly parts: ReadonlyArray<{ readonly index: number | null; readonly start: number; readonly end: number; readonly label: string }>
      readonly drop: { readonly at: number; readonly word: string | null } | null
    }
}

export interface CutDownTracks extends Common {
  readonly format: "cut-down"
  readonly sections: ReadonlyArray<EditSection> | null
  // the end card's question when the style ends with one (shown after the last section, 3 s, silent); null = none
  readonly endCard?: string | null
  readonly stillOf: (k: number) => string | null
}

export interface RankingTracks extends Common {
  readonly format: "ranking"
  readonly ranking: RankingDraft | null
  readonly stillOf: (rank: number, k: number) => string | null
}

export type TracksInput = NarratedTracks | CutDownTracks | RankingTracks

const track = (t: Pick<Track, "id" | "kind" | "label" | "clips"> & Partial<Track>): Track => ({
  video: null,
  note: null,
  noteSpan: null,
  marks: [],
  pinned: false,
  ...t
})

// A plain colour for the lanes that aren't a video's.
const COLORS = { voice: "var(--t-narr)", music: "var(--t-music)", captions: "var(--t-cap)", entries: "var(--t-shot)" } as const

const quoted = (text: string) => `“${text.length > 40 ? `${text.slice(0, 38).trimEnd()}…` : text}”`

const captionsTrack = (captions: TimelineCaptions | null, total: number): Track =>
  track({
    id: "captions",
    kind: "captions",
    label: "Captions",
    pinned: true,
    clips: captions?.cues.map((cue, i) => ({
      id: `cap-${i}`,
      start: cue.start,
      end: Math.min(Math.max(cue.end, cue.start + 0.05), total),
      label: cue.text,
      title: cue.text,
      color: COLORS.captions,
      frame: null,
      wave: null,
      target: { _tag: "Caption", index: i }
    })) ?? [],
    note: captions === null ? "No captions in this style · the .srt is still made" : captions.cues.length === 0 ? "No words to caption yet" : null
  })

// A narrated short: each video's shots and real lines, the voiceover's lines (with its waveform), the music's parts
// and the drop, and the captions.
const narratedTracks = (input: NarratedTracks): ShortTimeline => {
  const { layout } = input
  if (layout === null) return { total: 0, tracks: [], empty: "The timeline appears once the voiceover is made." }
  const total = Math.max(layout.total, 0.001)
  const narrationBeats = input.beats.flatMap((b, i) => (b._tag === "Narration" ? [i] : []))
  const realBeats = input.beats.flatMap((b, i) => (b._tag === "Real" ? [i] : []))
  const inserts = layout.reals.filter((r) => r.kind === "insert").length
  const narrationEnd = layout.narration.at(-1)?.end ?? layout.outroStart
  // the end card after the outro (the style's comment question): on the first video's lane, its closing line on the voice's
  const ctaBeat = input.beats.findIndex((b) => b._tag === "Cta")
  const card = layout.closing !== null && layout.closing.card ? layout.closing : null
  const videoTracks = input.videos.map((video, v): Track => {
    const shots = input.shots === null ? [] : input.shots.blocks.filter((b) => input.shots!.sourceOf(b.k) === v).map((b, i): Clip => ({
      id: `shot-${b.k}-${i}`,
      start: b.start,
      end: b.end,
      label: `${b.k + 1}`,
      title: `Shot ${b.k + 1} · ${video.name}`,
      color: video.color,
      frame: input.shots!.frameOf(b.k),
      wave: null,
      target: { _tag: "Shot", k: b.k }
    }))
    const reals = layout.reals.flatMap((r, i): ReadonlyArray<Clip> => r.source !== v ? [] : [{
      id: `real-${i}`,
      start: r.start,
      end: r.end,
      label: quoted(r.label),
      title: `Real line · ${video.name} · “${r.label}”`,
      color: video.color,
      frame: input.realFrame(r.kind, r.kind === "insert" ? i : i - inserts),
      wave: null,
      target: { _tag: "Real", beat: realBeats[i] ?? -1 }
    }])
    const endCard: ReadonlyArray<Clip> = card === null || v !== 0 ? [] : [{
      id: "end-card",
      start: card.start,
      end: card.end,
      label: "End card",
      title: `End card · “${card.label}” · SUBSCRIBE`,
      color: "var(--t-cap)",
      frame: null,
      wave: null,
      target: { _tag: "Narration", beat: ctaBeat }
    }]
    return track({
      id: `video:${video.id}`,
      kind: "video",
      label: video.name,
      video: v,
      clips: [...shots, ...reals, ...endCard].sort((a, b) => a.start - b.start),
      note: input.shots === null && v === 0 ? "Shots are picked at the Shots step" : null,
      noteSpan: input.shots === null ? { start: 0, end: narrationEnd } : null
    })
  })
  const voice = track({
    id: "voice",
    kind: "voice",
    label: "Voice",
    pinned: true,
    clips: layout.narration.map((n, i) => ({
      id: `vo-${i}`,
      start: n.start,
      end: n.end,
      label: n.label,
      title: n.label,
      color: COLORS.voice,
      frame: null,
      wave: input.voiceUrl === null ? null : { url: input.voiceUrl, from: n.from, to: n.to },
      target: { _tag: "Narration" as const, beat: narrationBeats[i] ?? -1 }
    })).concat(card === null ? [] : [{
      id: "vo-closing",
      start: card.start + END_CARD_LEAD,
      end: card.start + END_CARD_LEAD + (card.to - card.from),
      label: card.label,
      title: `Closing question · ${closingLine(card.label)}`,
      color: COLORS.voice,
      frame: null,
      wave: input.voiceUrl === null ? null : { url: input.voiceUrl, from: card.from, to: card.to },
      target: { _tag: "Narration" as const, beat: ctaBeat }
    }])
  })
  const { music } = input
  const musicTrack = music._tag !== "Bed"
    ? track({
      id: "music",
      kind: "music",
      label: "Music",
      pinned: true,
      clips: [],
      note: music._tag === "None" ? "No music · voice only" : "The song is fitted when the short is laid out"
    })
    : track({
      id: "music",
      kind: "music",
      label: "Music",
      pinned: true,
      clips: music.parts.filter((p) => p.end > p.start).map((p, i) => ({
        id: `music-${p.index ?? `bed-${i}`}`,
        start: p.start,
        end: Math.min(p.end, total),
        label: i === 0 ? `${p.label} · ${music.song}` : p.label,
        title: `${p.label} · ${music.song}`,
        color: COLORS.music,
        frame: null,
        wave: music.url === null ? null : { url: music.url, from: p.start, to: Math.min(p.end, total) },
        target: { _tag: "Music", index: p.index }
      })),
      marks: music.drop === null ? [] : [{ at: music.drop.at, label: music.drop.word === null ? "drop" : `drop · “${music.drop.word}”` }]
    })
  return { total, tracks: [...videoTracks, voice, musicTrack, captionsTrack(input.captions, total)], empty: null }
}

// A cut-down short: each video's sections (with their stills), the creator's own sound per section, and the captions;
// no music.
const cutDownTracks = (input: CutDownTracks): ShortTimeline => {
  if (input.sections === null || input.sections.length === 0) return { total: 0, tracks: [], empty: "The timeline appears once the sections are planned." }
  const sections = input.sections
  const blocks = sectionBlocks(sections)
  const sectionsEnd = blocks.at(-1)?.end ?? 0
  const question = input.endCard ?? null
  const total = Math.max(sectionsEnd + (question === null ? 0 : CUT_END_CARD_SECONDS), 0.001)
  const nameOf = (v: number) => input.videos[v]?.name ?? `Video ${v + 1}`
  const colorOf = (v: number) => input.videos[v]?.color ?? "var(--t-shot)"
  const videoTracks = input.videos.map((video, v) =>
    track({
      id: `video:${video.id}`,
      kind: "video",
      label: video.name,
      video: v,
      clips: blocks.filter((b) => b.source === v).map((b) => ({
        id: `section-${sections[b.k]!.key}`,
        start: b.start,
        end: b.end,
        label: BEATS[b.beat].label,
        title: `Section ${b.k + 1} · ${BEATS[b.beat].label} · ${video.name}`,
        color: video.color,
        frame: input.stillOf(b.k),
        wave: null,
        target: { _tag: "Section" as const, k: b.k }
      })).concat(question === null || v !== 0 ? [] : [{
        id: "end-card",
        start: sectionsEnd,
        end: total,
        label: "End card",
        title: `End card · “${question}” · SUBSCRIBE (no narrator in a cut-down)`,
        color: "var(--t-cap)",
        frame: null,
        wave: null,
        target: { _tag: "Section" as const, k: sections.length - 1 }
      }])
    })
  )
  const sound = track({
    id: "sound",
    kind: "sound",
    label: "Sound",
    pinned: true,
    clips: blocks.map((b) => ({
      id: `sound-${sections[b.k]!.key}`,
      start: b.start,
      end: b.end,
      label: "",
      title: `Section ${b.k + 1} · ${nameOf(b.source)}'s own sound`,
      color: colorOf(b.source),
      frame: null,
      wave: null,
      target: { _tag: "Section", k: b.k }
    }))
  })
  const music = track({ id: "music", kind: "music", label: "Music", pinned: true, clips: [], note: "No music · cut-downs keep the creator's own sound" })
  return { total, tracks: [...videoTracks, sound, captionsTrack(input.captions, total), music], empty: null }
}

// A ranking: its entries in play order (#1 last), each video's moments (before, care, after) with their stills, each
// entry's own sound, and the captions; no music.
const rankingTracks = (input: RankingTracks): ShortTimeline => {
  const ranking = input.ranking
  if (ranking === null || ranking.entries.length === 0) return { total: 0, tracks: [], empty: "The timeline appears once the moments are picked." }
  const blocks = entryBlocks(ranking)
  const total = Math.max(blocks.at(-1)?.end ?? 0, 0.001)
  const colorOf = (v: number) => input.videos[v]?.color ?? "var(--t-shot)"
  const nameOf = (v: number) => input.videos[v]?.name ?? `Video ${v + 1}`
  const entries = track({
    id: "entries",
    kind: "entries",
    label: "Entries",
    clips: blocks.map((b) => ({
      id: `entry-${b.rank}`,
      start: b.start,
      end: b.end,
      label: `#${b.rank} ${b.label} ${b.emoji}`.trim(),
      title: `#${b.rank} ${b.label} · ${nameOf(b.source)}`,
      color: colorOf(b.source),
      frame: null,
      wave: null,
      target: { _tag: "Entry", rank: b.rank, shot: null }
    }))
  })
  const moments = blocks.flatMap((b) => {
    const entry = ranking.entries.find((e) => e.rank === b.rank)
    let t = b.start
    return (entry?.shots ?? []).map((shot, k) => {
      const start = t
      t += Math.max(0, shot.end - shot.start)
      return { rank: b.rank, k, source: b.source, start, end: t, role: shot.role }
    })
  })
  const videoTracks = input.videos.map((video, v) =>
    track({
      id: `video:${video.id}`,
      kind: "video",
      label: video.name,
      video: v,
      clips: moments.filter((m) => m.source === v).map((m) => ({
        id: `moment-${m.rank}-${m.k}`,
        start: m.start,
        end: m.end,
        label: ROLE_NAMES[m.role],
        title: `#${m.rank} · ${ROLE_NAMES[m.role]} · ${video.name}`,
        color: video.color,
        frame: input.stillOf(m.rank, m.k),
        wave: null,
        target: { _tag: "Entry", rank: m.rank, shot: m.k }
      }))
    })
  )
  const sound = track({
    id: "sound",
    kind: "sound",
    label: "Sound",
    pinned: true,
    clips: blocks.map((b) => ({
      id: `sound-${b.rank}`,
      start: b.start,
      end: b.end,
      label: "",
      title: `#${b.rank} · ${nameOf(b.source)}'s own sound`,
      color: colorOf(b.source),
      frame: null,
      wave: null,
      target: { _tag: "Entry", rank: b.rank, shot: null }
    }))
  })
  const music = track({ id: "music", kind: "music", label: "Music", pinned: true, clips: [], note: "No music · rankings play each clip's own sound" })
  return { total, tracks: [entries, ...videoTracks, sound, captionsTrack(input.captions, total), music], empty: null }
}

// The short's lanes, by format.
export const tracksFor = (input: TracksInput): ShortTimeline =>
  input.format === "narrated" ? narratedTracks(input) : input.format === "cut-down" ? cutDownTracks(input) : rankingTracks(input)

// The clip on a lane at a moment of the short, if any (clicking empty lane space seeks instead).
export const clipAt = (t: Track, at: number): Clip | null => t.clips.find((c) => at >= c.start && at < c.end) ?? null

// The ruler's step: about 8–12 marks across the visible width, on a round number of seconds.
export const rulerStep = (seconds: number) => {
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300]) if (seconds / step <= 12) return step
  return 600
}

// The lanes a viewer hid, kept per viewer: any that no longer exist are dropped.
export const visibleTracks = (tracks: ReadonlyArray<Track>, hidden: ReadonlySet<string>) => tracks.filter((t) => !hidden.has(t.id))
