import type { PresetConfig } from "@viral/contracts"

const ADAM_VOICE: PresetConfig["voice"] = {
  provider: "elevenlabs",
  voiceId: "eGSd0uV8dNQnZuEEX9lu", // "Adam – Dominant, Firm"
  model: "eleven_v4",
  wordsPerSecond: 3.2
}

const CANDY_MUSIC: PresetConfig["music"] = { gain: 0.15, dropGain: 0.32, duckRatio: 3, duckThreshold: 0.03 }

// The settings behind your first candy short: 9:16 band layout, one lowercase caption word at a time, no
// ads, Adam at ~3.2 words/sec, and the music levels from its narrated.json.
const VIRAL_RECAP: PresetConfig = {
  canvas: [1080, 1920],
  mainHeight: 1216,
  stripAds: true,
  framing: "band",
  headline: null,
  voice: ADAM_VOICE,
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
  headline: { colors: ["#FF2A2A", "#FFFFFF"], y: 0.035, size: 0.075 },
  captions: { enabled: true, y: 0.74, mode: "chunk", maxWords: 3, case: "upper", highlight: "#FFD400", quoteBox: true },
  labels: true,
  credit: true,
  pace: { shotSeconds: 2.2 }
}

// Ensured by name on every start: missing ones are added, ones you've edited are left alone.
export const BUILT_IN_PRESETS: ReadonlyArray<{ readonly name: string; readonly config: PresetConfig }> = [
  { name: "Viral recap", config: VIRAL_RECAP },
  { name: "Headline full-bleed", config: HEADLINE_FULL_BLEED }
]

// The default when no preset is marked default yet.
export const DEFAULT_PRESET_NAME = "Viral recap"
export const DEFAULT_PRESET_CONFIG = VIRAL_RECAP
