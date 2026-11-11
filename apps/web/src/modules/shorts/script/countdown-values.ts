import { rankingEntries, type Script } from "@viral/contracts"

// ---- A narrated ranking's countdown, as the Script step and the timeline show it ----

// The skill's rank card colours: red, #1 yellow (render-narrated.py's rank_cards).
export const RANK_CARD_RED = "#E8202A"
export const RANK_CARD_YELLOW = "#FFD400"
export const rankCardColor = (rank: number) => rank === 1 ? RANK_CARD_YELLOW : RANK_CARD_RED

// How fast the narrator reads, to estimate an entry before there's a take (the server's ENTRY_WORDS_PER_SECOND).
const WORDS_PER_SECOND = 3.2
const words = (text: string) => text.split(/\s+/).filter((w) => /\w/.test(w)).length

// One entry: its rank, its beats [start, end), the video its real lines come from (null when it has none), and about how
// long it runs (narration at 3.2 words a second plus its real lines; #1's reveal take after the narration counted apart).
export interface CountdownEntry {
  readonly rank: number
  readonly start: number
  readonly end: number
  readonly source: number | null
  readonly seconds: number
  // the reveal take's length, for #1 (the real lines after the last narrated line); 0 for the others
  readonly revealSeconds: number
}

// The script as the countdown: the hook's last beat + 1 and each entry, or null when the script doesn't count down.
export const countdownOf = (script: Script, count: number): { readonly hookEnd: number; readonly entries: ReadonlyArray<CountdownEntry> } | null => {
  const { hookEnd, entries } = rankingEntries(script.beats, count)
  if (entries.length === 0) return null
  const lastNarration = script.beats.findLastIndex((b) => b._tag === "Narration")
  return {
    hookEnd,
    entries: entries.map((entry) => {
      let narrated = 0
      let clips = 0
      let reveal = 0
      let source: number | null = null
      script.beats.slice(entry.start, entry.end).forEach((beat, k) => {
        if (beat._tag === "Narration" && beat.skipped !== true) narrated += words(beat.text)
        if (beat._tag !== "Real") return
        source ??= beat.source ?? 0
        if (entry.start + k > lastNarration) reveal += beat.end - beat.start
        else clips += beat.end - beat.start
      })
      return { ...entry, source, seconds: narrated / WORDS_PER_SECOND + clips, revealSeconds: reveal }
    })
  }
}

// What a Script step header says above an entry: "#5 · Dolly the dog · about 22 s".
export const entryHeading = (entry: CountdownEntry, videoName: (source: number) => string) =>
  [
    `#${entry.rank}`,
    entry.source === null ? "no real line yet" : videoName(entry.source),
    `about ${Math.round(entry.seconds)} s${entry.revealSeconds > 0 ? ` + the ${Math.round(entry.revealSeconds)} s reveal` : ""}`
  ].join(" · ")
