import type { ThumbConfig } from "@viral/contracts"

// The thumbnail's words, line by line, as you edit them.
export type ThumbnailWords = ReadonlyArray<string>

export const wordsOf = (config: ThumbConfig): ThumbnailWords => config.lines.map((l) => l.text)

// How many lines you changed.
export const changedLines = (config: ThumbConfig, words: ThumbnailWords) =>
  config.lines.reduce((n, line, i) => n + (line.text !== (words[i] ?? line.text) ? 1 : 0), 0)

// The config with your words (in capitals, as the thumbnail draws them), keeping each line's colour and size;
// an emptied line is dropped.
export const withWords = (config: ThumbConfig, words: ThumbnailWords): ThumbConfig => ({
  ...config,
  lines: config.lines
    .map((line, i) => ({ ...line, text: (words[i] ?? line.text).trim().toUpperCase() }))
    .filter((line) => line.text !== "")
})

// The moments the thumbnail is made from: each one's time in its own video's seconds, and which of the short's
// videos it's from (`source`, by position; the first = 0).
export const momentsOf = (config: ThumbConfig) => [
  { name: "Hero", t: config.hero.src, source: config.hero.source ?? 0 },
  ...(config.inset === undefined ? [] : [{ name: "Face", t: config.inset.src, source: config.inset.source ?? 0 }]),
  ...(config.layout === "bold" ? [] : [{ name: "Background", t: config.background.src, source: config.background.source ?? 0 }])
]
