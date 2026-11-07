import type { MusicBed, MusicBedSegment, MusicTrack, Script, TranscriptWord } from "@viral/contracts"
import { narrationEnds } from "../editor-values.ts"

// The voiceover word the drop lands on when you haven't picked one: the first word of the last narrated line
// (the server picks it the same way).
export const defaultDropWord = (script: Script, words: ReadonlyArray<TranscriptWord>): number | null => {
  const ends = narrationEnds(script, words)
  return ends.length === 0 ? null : ends.length === 1 ? 0 : ends.at(-2)! + 1
}

const PART_NAMES: Record<MusicBedSegment["kind"], string> = {
  groove: "Groove",
  build: "Build-up",
  drop: "Drop",
  "drop-loop": "Drop again"
}
export const partName = (kind: MusicBedSegment["kind"]) => PART_NAMES[kind]

// The bed's parts on the short's timeline: where each plays in the short, named; a part looped back to back
// (the groove's bars) is one block, and so is a sliver too short to show.
export const bedBlocks = (bed: MusicBed) => {
  const blocks: Array<{ start: number; end: number; label: string }> = []
  for (const s of [...bed.segments].sort((a, b) => a.at - b.at)) {
    const block = { start: s.at, end: Math.min(bed.durationS, s.at + (s.to - s.from)), label: partName(s.kind) }
    const last = blocks.at(-1)
    // a sliver at the very end (the drop's bars again for a moment) belongs to the part before it
    if (last !== undefined && (block.end - block.start < 0.5 || (last.label === block.label && Math.abs(last.end - block.start) < 0.05))) {
      last.end = Math.max(last.end, block.end)
    } else blocks.push(block)
  }
  return blocks
}

// The parts of the song the short plays, in the song's own seconds, overlaps merged (a looped groove is one span).
export const songSpans = (bed: MusicBed): ReadonlyArray<{ readonly from: number; readonly to: number }> => {
  const sorted = [...bed.segments].map((s) => ({ from: s.from, to: s.to })).sort((a, b) => a.from - b.from)
  const merged: Array<{ from: number; to: number }> = []
  for (const span of sorted) {
    const last = merged.at(-1)
    if (last !== undefined && span.from <= last.to + 0.05) last.to = Math.max(last.to, span.to)
    else merged.push({ ...span })
  }
  return merged
}

// Where the voiceover is at a moment of the short: it pauses while a real line plays (`paused`), and has ended
// once the narration is over.
export const voiceAt = (pauses: ReadonlyArray<{ readonly at: number; readonly dur: number }>, shortSeconds: number) => {
  let offset = 0
  for (const p of [...pauses].sort((a, b) => a.at - b.at)) {
    if (shortSeconds < p.at + offset) return { t: shortSeconds - offset, paused: false }
    if (shortSeconds < p.at + offset + p.dur) return { t: p.at, paused: true }
    offset += p.dur
  }
  return { t: shortSeconds - offset, paused: false }
}

// A song can be fitted once its tempo and drop are known.
export const fittable = (track: MusicTrack) => track.bpm !== null && track.dropS !== null

const RIGHTS: Record<MusicTrack["rights"], string> = { owned: "Mine", licensed: "Licensed", unconfirmed: "Not confirmed" }
export const rightsName = (rights: MusicTrack["rights"]) => RIGHTS[rights]
