import {
  MAX_MUSIC_BLOCKS,
  type MusicArrangement,
  type MusicArrangementBlockConfig,
  type MusicBlock,
  type NarratedPlan,
  type TranscriptWord
} from "@viral/contracts"

// What an arrangement is checked against: the song's beat, the short's voiceover words (`s` in the short's
// seconds: see `wordStartsInShort`), its drop word, and its length when known.
export interface ArrangementContext {
  readonly barS: number
  readonly songDropS: number
  // the song's length; unknown skips the "past the song's end" check (the fit script still makes it)
  readonly songDurationS: number | null
  readonly dropWord: number | null
  readonly words: ReadonlyArray<{ readonly w: string; readonly s: number }>
  // the short's length; unknown skips the timing checks
  readonly durationS: number | null
}

// The song's bar grid, as music_bed.py's `bar_grid` counts it: bar 0 is the earliest whole bar before the drop.
export const barGrid = (barS: number, songDropS: number, songDurationS: number | null) => {
  const dropBar = Math.floor(songDropS / barS + 1e-6)
  const origin = songDropS - dropBar * barS
  const songBars = songDurationS === null ? null : Math.floor((songDurationS - origin) / barS + 1e-6)
  return { dropBar, origin, songBars }
}

// The voiceover word a block is pinned to, or null when it plays after the block before it.
export const pinnedWord = (block: MusicBlock, dropWord: number | null): number | null =>
  block.start === "after" ? null : block.start === "drop" ? dropWord : block.start.word

const seconds = (t: number) => `${t.toFixed(2)}s`

// Plain-language problems with an arrangement, none when it can be played: bars inside the song and in order,
// at least one loop, pinned words that exist and follow the voiceover in order, and every block heard before the
// short ends (or before the next pinned block starts).
export const checkArrangement = (arrangement: MusicArrangement, ctx: ArrangementContext): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const { blocks } = arrangement
  if (blocks.length === 0) return ["the arrangement has no blocks; use the automatic one instead"]
  if (blocks.length > MAX_MUSIC_BLOCKS) problems.push(`an arrangement has at most ${MAX_MUSIC_BLOCKS} blocks; this one has ${blocks.length}`)
  const { songBars } = barGrid(ctx.barS, ctx.songDropS, ctx.songDurationS)
  const name = (i: number) => `block ${i + 1}`
  blocks.forEach((b, i) => {
    if (b.fromBar < 0) problems.push(`${name(i)} starts at bar ${b.fromBar}, before the song begins (bar 0)`)
    if (songBars !== null && b.toBar > songBars) problems.push(`${name(i)} runs to bar ${b.toBar}, but the song has ${songBars} whole bars`)
    if (b.fromBar >= b.toBar) problems.push(`${name(i)} has to end after it starts (bars ${b.fromBar} to ${b.toBar})`)
    if (b.loops < 1) problems.push(`${name(i)} has to play at least once`)
  })

  // pinned starts: the word exists, and pins follow the voiceover in order
  const pins: Array<{ readonly i: number; readonly at: number }> = []
  blocks.forEach((b, i) => {
    if (b.start === "after") return
    const word = pinnedWord(b, ctx.dropWord)
    if (word === null) {
      problems.push(`${name(i)} starts on the drop word, but this short has none`)
      return
    }
    const w = ctx.words[word]
    if (w === undefined || word < 0) {
      problems.push(`${name(i)} is pinned to word ${word}, but the voiceover has ${ctx.words.length} words`)
      return
    }
    const last = pins.at(-1)
    if (last !== undefined && w.s <= last.at) {
      problems.push(`${name(i)} is pinned to "${w.w}" at ${seconds(w.s)}, not after ${name(last.i)}'s word at ${seconds(last.at)}; pinned blocks follow the voiceover in order`)
    }
    if (ctx.durationS !== null && w.s >= ctx.durationS) {
      problems.push(`${name(i)} is pinned to "${w.w}" at ${seconds(w.s)}, after the short ends at ${seconds(ctx.durationS)}`)
    }
    pins.push({ i, at: w.s })
  })
  if (problems.length > 0 || ctx.durationS === null) return problems

  // every block is heard: before the first pin the blocks end on it; after a pin they play on until the next
  // pin, or the short's end
  const length = (b: MusicBlock) => (b.toBar - b.fromBar) * ctx.barS
  const first = pins[0]
  if (first !== undefined && first.i > 0) {
    let end = first.at
    for (let i = first.i - 1; i > 0; i--) {
      end -= length(blocks[i]!) * blocks[i]!.loops
      if (end <= 0) problems.push(`${name(i - 1)} won't be heard: the blocks after it already fill the start before ${name(first.i)}`)
    }
  }
  const runStarts = first === undefined ? [{ i: 0, at: 0 }] : pins
  runStarts.forEach((run) => {
    const next = pins.find((p) => p.i > run.i)
    const until = next?.at ?? ctx.durationS!
    let at = run.at
    for (let i = run.i; i < (next?.i ?? blocks.length); i++) {
      if (at >= until) {
        problems.push(next === undefined
          ? `${name(i)} would start at ${seconds(at)}, after the short ends at ${seconds(until)}; remove it or pin it earlier`
          : `${name(i)} won't be heard: ${name(next.i)} is pinned to start at ${seconds(until)}, before it would begin`)
      }
      at += length(blocks[i]!) * blocks[i]!.loops
    }
  })
  return problems
}

// The arrangement as the narrated plan carries it for music_bed.py: snake_case, a drop start turned into the
// drop word.
export const planArrangement = (arrangement: MusicArrangement, dropWord: number | null): ReadonlyArray<MusicArrangementBlockConfig> =>
  arrangement.blocks.map((b) => {
    const word = pinnedWord(b, dropWord)
    return { from_bar: b.fromBar, to_bar: b.toBar, loops: b.loops, ...(word === null ? {} : { word }) }
  })

// The voiceover's words with their starts moved to where they play in the short: each insert plays after its
// word and pushes the rest later (as music_bed.py's `shifter` and the renderer lay the short out).
export const wordStartsInShort = (plan: NarratedPlan, words: ReadonlyArray<TranscriptWord>) => {
  const inserts = (plan.inserts ?? []).map((ins) => ({
    at: Math.round((words[ins.after_word]?.e ?? 0) * 1000) / 1000,
    dur: ins.end - ins.start
  }))
  return words.map((w) => ({ w: w.w, s: w.s + inserts.filter((i) => i.at < w.s).reduce((sum, i) => sum + i.dur, 0) }))
}
