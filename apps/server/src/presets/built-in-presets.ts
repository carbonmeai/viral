import type { PresetConfig } from "@viral/contracts"

// The creator's current narrator: Marcus at atempo ~1.1, which measured about 3.1–3.3 words/sec on the spicy and
// rescues takes. New libraries' built-in styles use him; a library's existing styles keep their voice.
const MARCUS_VOICE: PresetConfig["voice"] = {
  provider: "elevenlabs",
  voiceId: "3H55HGnNE1XjYxigHSAS", // "Marcus"
  model: "eleven_v4",
  wordsPerSecond: 3.2
}

// The voice of the first, fast-hype shorts (atempo ~1.25), kept in the "Fast hype" style.
const ADAM_VOICE: PresetConfig["voice"] = {
  provider: "elevenlabs",
  voiceId: "eGSd0uV8dNQnZuEEX9lu", // "Adam – Dominant, Firm"
  model: "eleven_v4",
  wordsPerSecond: 3.2
}

const CANDY_MUSIC: PresetConfig["music"] = { gain: 0.15, dropGain: 0.32, duckRatio: 3, duckThreshold: 0.03 }

// The settings behind your first candy short: 9:16 band layout, one lowercase caption word at a time, no
// ads, and the music levels from its narrated.json; narrated by Marcus (the candy short had Adam: see Fast hype).
const VIRAL_RECAP: PresetConfig = {
  canvas: [1080, 1920],
  mainHeight: 1216,
  stripAds: true,
  framing: "band",
  headline: null,
  voice: MARCUS_VOICE,
  captions: { enabled: true, y: 0.72, mode: "word", maxWords: 1, case: "lower", highlight: "#FFD400", quoteBox: false },
  labels: false,
  credit: false,
  pace: { shotSeconds: 1.3 },
  music: CANDY_MUSIC,
  loudnessLufs: -14
}

// The presentation of the competitor's candy short (10k views to the first short's 2.5k): full-bleed
// footage, a pinned red/white headline, 2–3 word uppercase captions with a yellow highlight, real-voice
// lines in a quote box, small labels, a source credit, and slower cuts.
const HEADLINE_FULL_BLEED: PresetConfig = {
  ...VIRAL_RECAP,
  framing: "full",
  headline: { colors: ["#FF2A2A", "#FFFFFF"], y: 0.035, size: 0.13 },
  captions: { enabled: true, y: 0.74, mode: "chunk", maxWords: 3, case: "upper", highlight: "#FFD400", quoteBox: true },
  labels: true,
  credit: true,
  pace: { shotSeconds: 2.2 }
}

// The first candy short exactly as it was made: Viral recap's look with Adam's fast, hyped read.
const FAST_HYPE: PresetConfig = { ...VIRAL_RECAP, voice: ADAM_VOICE }

// Ensured by name on every start: missing ones are added, ones you've edited (or already have) are left alone, so a
// change here reaches new libraries only.
export const BUILT_IN_PRESETS: ReadonlyArray<{ readonly name: string; readonly config: PresetConfig }> = [
  { name: "Viral recap", config: VIRAL_RECAP },
  { name: "Headline full-bleed", config: HEADLINE_FULL_BLEED },
  { name: "Fast hype", config: FAST_HYPE }
]

// The default when no preset is marked default yet.
export const DEFAULT_PRESET_NAME = "Viral recap"
export const DEFAULT_PRESET_CONFIG = VIRAL_RECAP
