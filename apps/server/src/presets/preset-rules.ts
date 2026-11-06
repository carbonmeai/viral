import type { PresetConfig } from "@viral/contracts"

const HEX = /^#[0-9a-fA-F]{6}$/
const NAME_CHARS = 40

const between = (problems: Array<string>, label: string, value: number, min: number, max: number) => {
  if (!Number.isFinite(value) || value < min || value > max) problems.push(`${label} must be ${min}–${max}`)
}
const colour = (problems: Array<string>, label: string, value: string) => {
  if (!HEX.test(value)) problems.push(`${label} must be a colour like #FFD400`)
}

// Checks a style's settings before they're saved, so a short is never made from values the renderer or the
// stages can't use. Empty when the style is good.
export const checkPresetConfig = (config: PresetConfig): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const [width, height] = config.canvas
  if (!(Number.isInteger(width) && Number.isInteger(height) && width >= 360 && height >= 640)) problems.push("the canvas must be at least 360×640")
  between(problems, "the sharp band's height", config.mainHeight, 200, height)
  if (config.headline !== null) {
    config.headline.colors.forEach((c, i) => colour(problems, `headline line ${i + 1}'s colour`, c))
    between(problems, "the headline's position", config.headline.y, 0, 0.5)
    between(problems, "the headline's size", config.headline.size, 0.04, 0.2)
  }
  between(problems, "the captions' position", config.captions.y, 0.1, 0.95)
  between(problems, "words per caption", config.captions.maxWords, 1, 6)
  if (!Number.isInteger(config.captions.maxWords)) problems.push("words per caption must be a whole number")
  if (config.captions.mode === "word" && config.captions.maxWords !== 1) problems.push("one-word captions show 1 word at a time")
  colour(problems, "the caption highlight", config.captions.highlight)
  between(problems, "the average shot length", config.pace.shotSeconds, 0.6, 5)
  between(problems, "the music level", config.music.gain, 0, 1)
  between(problems, "the music level after the drop", config.music.dropGain, 0, 1)
  between(problems, "the music ducking ratio", config.music.duckRatio, 1, 20)
  between(problems, "the music ducking threshold", config.music.duckThreshold, 0, 1)
  between(problems, "the loudness", config.loudnessLufs, -30, -6)
  between(problems, "the narrator's pace", config.voice.wordsPerSecond, 2, 5)
  if (config.voice.voiceId.trim() === "") problems.push("the style needs a voice")
  return problems
}

// A style's name: trimmed, not empty, short enough for the sidebar and pickers.
export const checkPresetName = (name: string): ReadonlyArray<string> => {
  const trimmed = name.trim()
  if (trimmed === "") return ["the style needs a name"]
  if (trimmed.length > NAME_CHARS) return [`keep the name under ${NAME_CHARS} characters`]
  return []
}
