import type { PresetConfig } from "@viral/contracts"

// The settings behind the candy short you called "perfect": 9:16, no ads, Adam at ~3.2 words/sec,
// burned-in captions, and the music levels from its narrated.json. Seeded on first start.
export const DEFAULT_PRESET_NAME = "Viral recap"

export const DEFAULT_PRESET_CONFIG: PresetConfig = {
  canvas: [1080, 1920],
  mainHeight: 1216,
  stripAds: true,
  voice: {
    provider: "elevenlabs",
    voiceId: "eGSd0uV8dNQnZuEEX9lu", // "Adam – Dominant, Firm"
    model: "eleven_v4",
    wordsPerSecond: 3.2
  },
  captions: { enabled: true, y: 0.72, lowercase: true },
  music: { gain: 0.15, dropGain: 0.32, duckRatio: 3, duckThreshold: 0.03 },
  loudnessLufs: -14
}
