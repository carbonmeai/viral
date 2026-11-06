import type { MusicTrack, NarratedAnnotation, NarratedPlan, PresetConfig, Script, ShotPlan, TranscriptWord } from "@viral/contracts"

// How long a marker stays on screen.
const MARKER_SECONDS = 1.4
// The music bed's build: whole bars looped before the drop, then the groove after it.
const BUILD_BARS = 8
const GROOVE_BARS = 4

export interface NarratedInput {
  readonly slug: string
  readonly title: string
  // absolute paths
  readonly source: string
  readonly sourceTranscript: string
  readonly voiceover: string
  readonly voiceoverTranscript: string
  readonly voiceoverWords: ReadonlyArray<TranscriptWord>
  readonly preset: PresetConfig
  readonly script: Script
  readonly shots: ShotPlan
  // sponsor reads, ads and end screens, in source seconds
  readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number }>
  // "Video: <channel>" when the footage isn't yours, else null
  readonly credit: string | null
  // the short's track, used when its BPM and drop are known, with its absolute path
  readonly music: { readonly track: MusicTrack; readonly file: string } | null
  // the voiceover word the music drops on (the start of the last narrated line)
  readonly dropWord: number | null
}

const marker = (m: ShotPlan["markers"][number], words: ReadonlyArray<TranscriptWord>, labels: boolean): ReadonlyArray<NarratedAnnotation> => {
  const at = { word: m.word, word_text: words[m.word]?.w ?? "", dur: MARKER_SECONDS, x: m.x, y: m.y }
  switch (m._tag) {
    case "Label":
      return labels ? [{ type: "label", ...at, text: m.text.toLowerCase() }] : []
    case "Circle":
      return [{ type: "circle", ...at }]
    case "Arrow":
      return [{ type: "arrow", ...at }]
  }
}

// Approach meets style: the approved shot plan, laid out the way the preset says, as the renderer's plan.
// Deterministic, so a short can be re-rendered in another style without touching the agent work.
export const assembleNarrated = (input: NarratedInput): NarratedPlan => {
  const { preset, shots, voiceoverWords: words } = input
  const captions = preset.captions
  const music = input.music !== null && input.music.track.bpm !== null && input.music.track.dropS !== null && input.dropWord !== null
    ? {
      music: {
        file: input.music.file,
        drop: input.music.track.dropS,
        bpm: input.music.track.bpm,
        build_bars: BUILD_BARS,
        groove_bars: GROOVE_BARS,
        drop_word: input.dropWord,
        drop_word_text: words[input.dropWord]?.w ?? "",
        drop_gain: preset.music.dropGain,
        note: "the drop lands on the last narrated line, then carries the real reactions"
      },
      music_gain: preset.music.gain,
      duck_ratio: preset.music.duckRatio,
      duck_threshold: preset.music.duckThreshold
    }
    : {}
  const headline = preset.headline !== null && input.script.headline !== null
    ? {
      headline: {
        lines: input.script.headline.map((text, i) => ({ text, color: preset.headline!.colors[i]! })),
        y: preset.headline.y,
        size: preset.headline.size
      }
    }
    : {}
  const annotations = shots.markers.flatMap((m) => marker(m, words, preset.labels))

  return {
    slug: input.slug,
    title: input.title,
    source: input.source,
    source_transcript: input.sourceTranscript,
    voiceover: input.voiceover,
    voiceover_transcript: input.voiceoverTranscript,
    canvas: [preset.canvas[0], preset.canvas[1]],
    main_height: preset.mainHeight,
    framing: preset.framing,
    captions: captions.enabled,
    caption_y: captions.y,
    caption_mode: captions.mode,
    caption_max_words: captions.maxWords,
    caption_case: captions.case,
    caption_highlight: captions.highlight,
    quote_box: captions.quoteBox,
    ...headline,
    ...(preset.credit && input.credit !== null ? { credit: input.credit } : {}),
    highlights: Object.fromEntries(shots.highlights.map((word) => [word, captions.highlight])),
    exclude: input.excluded.map((r) => [r.start, r.end] as const),
    exclude_note: "sponsor reads, ads and end screens",
    shots: shots.shots.map((shot) => ({
      src: shot.src,
      word: shot.word,
      word_text: shot.wordText,
      ...(shot.fit === undefined ? {} : { fit: shot.fit }),
      ...(shot.cropX === undefined ? {} : { crop_x: shot.cropX }),
      ...(shot.speed === undefined ? {} : { speed: shot.speed }),
      note: shot.note
    })),
    inserts: shots.inserts.map((clip) => ({
      start: clip.start,
      end: clip.end,
      after_word: clip.afterWord,
      after_word_text: clip.afterWordText,
      note: clip.quote
    })),
    outro: shots.outro.map((clip) => ({ start: clip.start, end: clip.end, note: clip.quote })),
    ...(annotations.length === 0 ? {} : { annotations }),
    ...music,
    lufs: preset.loudnessLufs
  }
}
