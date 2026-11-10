import {
  type GeneratedThumbnail,
  type ThumbConfig,
  THUMBNAIL_GATEWAY_USD_PER_IMAGE,
  THUMBNAIL_OPTIONS,
  THUMBNAIL_USD_PER_CREDIT,
  thumbnailRoundCredits
} from "@viral/contracts"

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

// Which service the next round will use, as the server picks it (thumbnail-images.ts): ElevenLabs first, the AI
// Gateway when ElevenLabs' plan can't make images. The last round's service says which one answered; before any round,
// with both keys set, it's either (ElevenLabs is tried first and a plan refusal costs nothing).
export type RoundService = "elevenlabs" | "ai-gateway" | "either"
export const nextRoundService = (
  last: GeneratedThumbnail["service"] | null,
  keys: { readonly elevenlabs: boolean; readonly gateway: boolean }
): RoundService =>
  last === "ai-gateway" && keys.gateway ? "ai-gateway"
  : last === "elevenlabs" && keys.elevenlabs ? "elevenlabs"
  : keys.elevenlabs && keys.gateway ? "either"
  : keys.gateway ? "ai-gateway"
  : "elevenlabs"

// What a round is expected to cost, said before Generate, for the service that will make it: about $0.25 an image on
// ElevenLabs (billed in credits), about $0.06 on the AI Gateway (billed in dollars), a range when it could be either.
export const roundCost = (service: RoundService = "elevenlabs") => {
  const eleven = `$${(thumbnailRoundCredits() * THUMBNAIL_USD_PER_CREDIT).toFixed(2)}`
  const gateway = `$${(THUMBNAIL_OPTIONS * THUMBNAIL_GATEWAY_USD_PER_IMAGE).toFixed(2)}`
  const price = service === "elevenlabs" ? `about ${eleven} on ElevenLabs`
    : service === "ai-gateway" ? `about ${gateway} on the AI Gateway`
    : `about ${gateway}–${eleven} (ElevenLabs first, else the AI Gateway)`
  return `${THUMBNAIL_OPTIONS} images · ${price}`
}

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
