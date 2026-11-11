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
  loudnessLufs: -14,
  // every short ends with a comment question and a subscribe ask on an end card (the skills since 10 Nov, Decision 5)
  commentQuestion: true
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

// The creator's best-performing narrated short (spicy): Viral recap's look with the skill's frame (a taller band, captions
// lower), soft joins where real clips meet the narration, and the voice levelled with the clips (the take at −10 LUFS,
// played at 1.7). Made for story-recap shorts, whose payoff is one long real take.
const STORY_RECAP: PresetConfig = {
  ...VIRAL_RECAP,
  mainHeight: 1280,
  captions: { ...VIRAL_RECAP.captions, y: 0.78 },
  softJoins: true,
  voiceLevel: { lufs: -10, gain: 1.7 }
}

// The creator's approved narrated ranking (rescues5, "Top 5 Animal Comebacks"): Viral recap's band (1216) with the
// captions low at 0.855, in the blur under the picture, away from the videos' own burned-in subtitles; soft joins and
// the voice levelled with the clips (played at 1.7), no music. Narrated rankings get it when made without a style.
const RANKING_NARRATED: PresetConfig = {
  ...VIRAL_RECAP,
  captions: { ...VIRAL_RECAP.captions, y: 0.855 },
  softJoins: true,
  voiceLevel: { lufs: -10, gain: 1.7 }
}
export const RANKING_NARRATED_PRESET_NAME = "Ranking narrated"

// Ensured by name on every start: missing ones are added, ones you've edited (or already have) are left alone, so a
// change here reaches new libraries only (a library's existing styles keep the comment question off until it's switched
// on in the Style editor).
export const BUILT_IN_PRESETS: ReadonlyArray<{ readonly name: string; readonly config: PresetConfig }> = [
  { name: "Viral recap", config: VIRAL_RECAP },
  { name: "Headline full-bleed", config: HEADLINE_FULL_BLEED },
  { name: "Fast hype", config: FAST_HYPE },
  { name: "Story recap", config: STORY_RECAP },
  { name: RANKING_NARRATED_PRESET_NAME, config: RANKING_NARRATED }
]

// The default when no preset is marked default yet.
export const DEFAULT_PRESET_NAME = "Viral recap"
export const DEFAULT_PRESET_CONFIG = VIRAL_RECAP
