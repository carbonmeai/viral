import { MAX_MUSIC_BLOCKS, type MusicBed, type MusicBedArrangement, type MusicBedSegment, type MusicBlock, type MusicTrack, type Script, type TranscriptWord } from "@viral/contracts"
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

// Where the voiceover is at a moment of the short: it pauses while a real line plays (`paused`), jumps over a skipped
// line after it, and has ended once the narration is over.
export const voiceAt = (pauses: ReadonlyArray<{ readonly at: number; readonly dur: number; readonly skip?: number }>, shortSeconds: number) => {
  let offset = 0
  for (const p of [...pauses].sort((a, b) => a.at - b.at)) {
    if (shortSeconds < p.at + offset) return { t: shortSeconds - offset, paused: false }
    if (shortSeconds < p.at + offset + p.dur) return { t: p.at, paused: true }
    // after the line, the voiceover picks up `skip` seconds on (past a line the real line says anyway)
    offset += p.dur - (p.skip ?? 0)
  }
  return { t: shortSeconds - offset, paused: false }
}

// A song can be fitted once its tempo and drop are known.
export const fittable = (track: MusicTrack) => track.bpm !== null && track.dropS !== null

const RIGHTS: Record<MusicTrack["rights"], string> = { owned: "Mine", licensed: "Licensed", unconfirmed: "Not confirmed" }
export const rightsName = (rights: MusicTrack["rights"]) => RIGHTS[rights]

// ——— The arrangement: which bars of the song play, in what order, and where they start ———

// The song's bar grid as the bed counts it: bar 0 is the earliest whole bar before the drop (`origin` seconds into
// the song), so the drop sits on a bar line (`dropBar`); `songBars` is how many whole bars the song has.
export interface BarGrid {
  readonly barS: number
  readonly origin: number
  readonly dropBar: number
  readonly songBars: number
}

export const gridOf = (bed: MusicBed): BarGrid | null =>
  bed.arrangement === undefined ? null : {
    barS: bed.barS,
    origin: bed.songDropS - bed.arrangement.dropBar * bed.barS,
    dropBar: bed.arrangement.dropBar,
    songBars: bed.arrangement.songBars
  }

// The arrangement's blocks as you edit them (the bed's own adds where they played).
export const blocksOf = (arrangement: MusicBedArrangement): ReadonlyArray<MusicBlock> =>
  arrangement.blocks.map((b) => ({ fromBar: b.fromBar, toBar: b.toBar, loops: b.loops, start: b.start }))

export const sameBlocks = (a: ReadonlyArray<MusicBlock>, b: ReadonlyArray<MusicBlock>) => JSON.stringify(a) === JSON.stringify(b)

// A block's bars in the song's own seconds.
export const songRangeOf = (block: Pick<MusicBlock, "fromBar" | "toBar">, grid: BarGrid) => ({
  from: grid.origin + block.fromBar * grid.barS,
  to: grid.origin + block.toBar * grid.barS
})

// The song bar nearest a moment of the song, kept inside it.
export const barAt = (songSeconds: number, grid: BarGrid) =>
  Math.max(0, Math.min(grid.songBars, Math.round((songSeconds - grid.origin) / grid.barS)))

// A block's name: the drop (from the drop's bar on), the build-up (the bars that lead into it), else its bars,
// counted from 1 as a musician would.
export const blockName = (block: Pick<MusicBlock, "fromBar" | "toBar">, dropBar: number) =>
  block.fromBar === dropBar ? "Drop" : block.toBar === dropBar ? "Build-up" : `Bars ${block.fromBar + 1}–${block.toBar}`

// The name with its loops, as the music lane labels it: "Bars 9–12 ×3".
export const blockLabel = (block: MusicBlock, dropBar: number) => `${blockName(block, dropBar)}${block.loops > 1 ? ` ×${block.loops}` : ""}`

// The voiceover word a block starts on, or null when it plays after the block before it.
export const pinOf = (block: MusicBlock, dropWord: number | null): number | null =>
  block.start === "after" ? null : block.start === "drop" ? dropWord : block.start.word

// What a block is placed against: one bar's length, the drop word, where each voiceover word starts in the short
// (null when there's no such word) and the short's length.
export interface PlaceContext {
  readonly barS: number
  readonly dropWord: number | null
  readonly wordAt: (word: number) => number | null
  readonly total: number
}

// Where a block plays in the short (null: not heard), and a moment one of its loops starts on (`phase`), for
// drawing where it repeats.
export interface PlacedBlock {
  readonly atS: number
  readonly endS: number
  readonly phase: number
}

const lengthOf = (b: MusicBlock, barS: number) => (b.toBar - b.fromBar) * barS

const pinsOf = (blocks: ReadonlyArray<MusicBlock>, ctx: PlaceContext) => {
  const pins: Array<{ readonly i: number; readonly at: number }> = []
  blocks.forEach((b, i) => {
    const word = pinOf(b, ctx.dropWord)
    const at = word === null ? null : ctx.wordAt(word)
    if (at !== null) pins.push({ i, at })
  })
  return pins
}

// Where each block plays, the way the bed lays them out: blocks before the first pinned one end exactly on it (the
// first of them loops to fill the start, entered part-way); from a pin, blocks play on in order with their loops,
// and the last one before the next pin (or the short's end) keeps looping until then.
export const placeBlocks = (blocks: ReadonlyArray<MusicBlock>, ctx: PlaceContext): ReadonlyArray<PlacedBlock | null> => {
  const placed: Array<PlacedBlock | null> = blocks.map(() => null)
  const pins = pinsOf(blocks, ctx)
  const first = pins[0]
  if (first !== undefined && first.i > 0) {
    let end = first.at
    for (let i = first.i - 1; i >= 0 && end > 0; i--) {
      const start = i === 0 ? 0 : end - lengthOf(blocks[i]!, ctx.barS) * blocks[i]!.loops
      placed[i] = { atS: Math.max(0, start), endS: end, phase: end }
      end = start
    }
  }
  const runs = first === undefined ? [{ i: 0, at: 0 }] : pins
  runs.forEach((run) => {
    const next = pins.find((p) => p.i > run.i)
    const last = (next?.i ?? blocks.length) - 1
    const until = Math.min(next?.at ?? ctx.total, ctx.total)
    let at = run.at
    for (let i = run.i; i <= last; i++) {
      if (at >= until) break
      const plays = lengthOf(blocks[i]!, ctx.barS) * blocks[i]!.loops
      placed[i] = { atS: at, endS: i === last ? until : Math.min(until, at + plays), phase: at }
      at += plays
    }
  })
  return placed
}

// Where a placed block's loops repeat inside it (not its own edges).
export const loopTicks = (placed: PlacedBlock, block: MusicBlock, barS: number): ReadonlyArray<number> => {
  const length = lengthOf(block, barS)
  if (length <= 0) return []
  const ticks: Array<number> = []
  const k0 = Math.ceil((placed.atS - placed.phase) / length + 1e-6)
  for (let k = k0; placed.phase + k * length < placed.endS - 1e-3 && ticks.length < 64; k++) ticks.push(placed.phase + k * length)
  return ticks.filter((t) => t > placed.atS + 1e-3)
}

const say = (t: number) => `${t.toFixed(1)}s`

// Plain-language problems with an arrangement, checked before it goes to the server (which checks it again): the
// bars inside the song, at least one play, pinned words that exist and follow the narration in order, and every
// part heard. Parts are numbered from 1 as the list shows them.
export const arrangementProblems = (
  blocks: ReadonlyArray<MusicBlock>,
  ctx: PlaceContext & { readonly songBars: number; readonly words: ReadonlyArray<TranscriptWord> }
): ReadonlyArray<string> => {
  if (blocks.length === 0) return ["There are no parts. Add one, or reset to automatic."]
  const problems: Array<string> = []
  if (blocks.length > MAX_MUSIC_BLOCKS) problems.push(`A short can have up to ${MAX_MUSIC_BLOCKS} parts; this has ${blocks.length}.`)
  const name = (i: number) => `Part ${i + 1}`
  blocks.forEach((b, i) => {
    if (b.fromBar < 0 || b.toBar > ctx.songBars) problems.push(`${name(i)} runs past the song: it has ${ctx.songBars} bars.`)
    if (b.fromBar >= b.toBar) problems.push(`${name(i)} needs at least one bar.`)
    if (b.loops < 1) problems.push(`${name(i)} has to play at least once.`)
  })
  let lastPin: { readonly i: number; readonly at: number } | null = null
  blocks.forEach((b, i) => {
    if (b.start === "after") return
    const word = pinOf(b, ctx.dropWord)
    if (word === null) return void problems.push(`${name(i)} starts on the drop word, but there isn’t one yet.`)
    const at = ctx.wordAt(word)
    if (at === null) return void problems.push(`${name(i)} is pinned to a word the narration doesn’t have.`)
    const text = ctx.words[word]?.w ?? ""
    if (lastPin !== null && at <= lastPin.at) {
      problems.push(`${name(i)} starts on “${text}”, which comes before ${name(lastPin.i).toLowerCase()}’s word. Pinned parts follow the narration in order.`)
    }
    if (at >= ctx.total) problems.push(`${name(i)} starts on “${text}”, after the short ends.`)
    lastPin = { i, at }
  })
  if (problems.length > 0) return problems
  const placed = placeBlocks(blocks, ctx)
  const pins = pinsOf(blocks, ctx)
  placed.forEach((p, i) => {
    if (p !== null) return
    const next = pins.find((x) => x.i > i)
    const before = pins[0] !== undefined && i < pins[0].i
    problems.push(
      before
        ? `${name(i)} isn’t heard: the parts after it already fill the start before ${name(pins[0]!.i).toLowerCase()}.`
        : next === undefined
        ? `${name(i)} would start after the short ends. Remove it or pin it earlier.`
        : `${name(i)} isn’t heard: ${name(next.i).toLowerCase()} starts at ${say(next.at)}, before it would.`
    )
  })
  return problems
}

// The server's problems, said the way the editor names things ("block 2" is part 2), each a sentence.
export const plainProblems = (problems: ReadonlyArray<string>) =>
  problems.map((p) => {
    const text = p.replace(/\bblocks?\b/g, (m) => (m === "blocks" ? "parts" : "part"))
    const line = text.charAt(0).toUpperCase() + text.slice(1)
    return /[.!?]$/.test(line) ? line : `${line}.`
  })

// ——— Edits: each returns the new list of blocks ———

const at = <A>(list: ReadonlyArray<A>, i: number, value: A) => list.map((x, k) => (k === i ? value : x))

export const withBlock = (blocks: ReadonlyArray<MusicBlock>, i: number, change: Partial<MusicBlock>) =>
  blocks[i] === undefined ? blocks : at(blocks, i, { ...blocks[i], ...change })

// Splits a block at a bar inside it: the first half keeps its start, the second plays after it, each once (a
// looped block's loops stay on the first half).
export const splitBlock = (blocks: ReadonlyArray<MusicBlock>, i: number, bar: number): ReadonlyArray<MusicBlock> => {
  const b = blocks[i]
  if (b === undefined || bar <= b.fromBar || bar >= b.toBar) return blocks
  return [...blocks.slice(0, i), { ...b, toBar: bar }, { fromBar: bar, toBar: b.toBar, loops: 1, start: "after" }, ...blocks.slice(i + 1)]
}

// A copy straight after it, playing after it (a pinned start isn't copied: two parts can't start on one word).
export const duplicateBlock = (blocks: ReadonlyArray<MusicBlock>, i: number): ReadonlyArray<MusicBlock> => {
  const b = blocks[i]
  return b === undefined ? blocks : [...blocks.slice(0, i + 1), { ...b, start: "after" }, ...blocks.slice(i + 1)]
}

export const deleteBlock = (blocks: ReadonlyArray<MusicBlock>, i: number) => blocks.filter((_, k) => k !== i)

export const moveBlock = (blocks: ReadonlyArray<MusicBlock>, i: number, by: -1 | 1): ReadonlyArray<MusicBlock> => {
  const j = i + by
  if (blocks[i] === undefined || blocks[j] === undefined) return blocks
  return at(at(blocks, i, blocks[j]), j, blocks[i])
}

// A new part at the end: the four bars after the last one (or the song's last four), playing after it.
export const addBlock = (blocks: ReadonlyArray<MusicBlock>, songBars: number): ReadonlyArray<MusicBlock> => {
  const from = Math.min(blocks.at(-1)?.toBar ?? 0, Math.max(0, songBars - 4))
  return [...blocks, { fromBar: from, toBar: Math.min(songBars, from + 4), loops: 1, start: "after" }]
}

// Moves a block to other bars of the song, keeping its length when it can.
export const moveRange = (block: MusicBlock, fromBar: number, songBars: number): MusicBlock => {
  const length = block.toBar - block.fromBar
  const from = Math.max(0, Math.min(songBars - length, fromBar))
  return { ...block, fromBar: from, toBar: from + length }
}

// Where the bed actually played each block (the server's seconds), with the loop phase the bed would use.
export const placedFrom = (
  blocks: ReadonlyArray<MusicBlock & { readonly atS: number | null; readonly endS: number | null }>,
  ctx: PlaceContext
): ReadonlyArray<PlacedBlock | null> => {
  const estimate = placeBlocks(blocks, ctx)
  return blocks.map((b, i) => {
    if (b.atS === null || b.endS === null) return null
    const e = estimate[i]
    // a block that fills the start loops back from its end
    return { atS: b.atS, endS: b.endS, phase: e !== null && e !== undefined && e.phase === e.endS && e.atS !== e.phase ? b.endS : b.atS }
  })
}
