import { type GeneratedThumbnail, type ThumbConfig, THUMBNAIL_OPTIONS, THUMBNAIL_USD_PER_CREDIT, thumbnailRoundCredits } from "@viral/contracts"

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

// ── AI thumbnails ──────────────────────────────────────────────────────────────────────────────────────────────────

// The option in use (1-based): the one you chose, else the agent's pick; null when none is.
export const optionInUse = (generated: GeneratedThumbnail): number | null => generated.chosen ?? generated.recommended

// What a round is expected to cost, said before Generate: about $0.25 an image (ElevenLabs bills it in credits, the AI
// Gateway in dollars).
export const roundCost = () => `${THUMBNAIL_OPTIONS} images · about $${(thumbnailRoundCredits() * THUMBNAIL_USD_PER_CREDIT).toFixed(2)}`

// What a round cost: the Gateway's dollars, or ElevenLabs' credits.
export const roundSpend = (generated: GeneratedThumbnail) =>
  generated.service === "ai-gateway"
    ? generated.costUsd === undefined ? "Not reported" : `$${generated.costUsd.toFixed(2)}`
    : generated.credits === 0 ? "None" : `about ${generated.credits.toLocaleString("en-US")} ElevenLabs credits`

// Each real frame's name, in the order the image model numbers them: "Reaction 1", "Reaction 2", "Hero", "Graphic".
export const inputNames = (inputs: GeneratedThumbnail["inputs"]): ReadonlyArray<string> => {
  let reaction = 0
  return inputs.map((i) => i.role === "reaction" ? `Reaction ${++reaction}` : i.role === "hero" ? "Hero" : "Graphic")
}

// One option's line under it: why it wasn't made, or how its faces matched the real frames.
export const optionNote = (option: GeneratedThumbnail["options"][number]) =>
  option.image === null
    ? option.failure ?? "Not made."
    : option.faces === null
    ? "Not checked."
    : `Faces ${Math.round(option.faces)}/10${option.note === null || option.note === "" ? "" : ` · ${option.note}`}`
