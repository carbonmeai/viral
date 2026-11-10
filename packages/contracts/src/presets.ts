import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export const PresetId = Schema.String.pipe(Schema.brand("PresetId"))
export type PresetId = typeof PresetId.Type

// A style profile: the defaults a short is made with.
export const PresetConfig = Schema.Struct({
  canvas: Schema.Tuple([Schema.Int, Schema.Int]),
  // height of the sharp center band; blurred source fills above and below
  mainHeight: Schema.Int,
  // drop sponsor reads, built-in ads, QR codes and end screens from the shots
  stripAds: Schema.Boolean,
  voice: Schema.Struct({
    provider: Schema.Literal("elevenlabs"),
    voiceId: Schema.String,
    model: Schema.String,
    // the voiceover is sped up until it reaches this pace
    wordsPerSecond: Schema.Finite
  }),
  // band: a sharp band over a blurred fill · full: the footage cropped to fill the frame
  framing: Schema.Literals(["band", "full"]),
  // a pinned headline restating the open loop (its text comes from the script stage); null = none
  headline: Schema.NullOr(Schema.Struct({
    // first line, second line (e.g. red + white)
    colors: Schema.Tuple([Schema.String, Schema.String]),
    // top of the headline, as a fraction of the frame height
    y: Schema.Finite,
    // the first line's largest font size as a fraction of the frame width (the renderer's default is 0.13); the
    // second line is 60% of it, and both shrink to fit the width
    size: Schema.Finite
  })),
  captions: Schema.Struct({
    // false when the short is finished in an editor (e.g. CapCut) from the mp4 + srt
    enabled: Schema.Boolean,
    y: Schema.Finite,
    // word: one word at a time · chunk: up to `maxWords` words, with the key word highlighted
    mode: Schema.Literals(["word", "chunk"]),
    maxWords: Schema.Int,
    case: Schema.Literals(["lower", "upper", "as-spoken"]),
    // colour of the highlighted word in a chunk
    highlight: Schema.String,
    // real-voice lines (inserts, outro) in a quote box, so viewers see who's talking
    quoteBox: Schema.Boolean
  }),
  // small spaced text labels ("STICKY", "VERSION 2") placed by the shots stage
  labels: Schema.Boolean,
  // "Video: <channel>" overlay when the footage isn't yours
  credit: Schema.Boolean,
  // rankings: a small "via <channel>" line under each clip; absent = off (the channels are in the description)
  rankingVia: Schema.optionalKey(Schema.Boolean),
  // target average shot length, a guide for the shots stage
  pace: Schema.Struct({ shotSeconds: Schema.Finite }),
  music: Schema.Struct({
    gain: Schema.Finite,
    dropGain: Schema.Finite,
    duckRatio: Schema.Finite,
    duckThreshold: Schema.Finite
  }),
  loudnessLufs: Schema.Finite,
  // short fades where real clips meet the narration, and a 0.25 s breath before each clip; absent = hard cuts
  softJoins: Schema.optionalKey(Schema.Boolean),
  // the voiceover take normalised to `lufs` (the skill's −10, since a raw take sits near −27 against clips near −9)
  // and played at `gain` in the mix (1.7), so narration and clips sit level; absent = the take as spoken, gain 1
  voiceLevel: Schema.optionalKey(Schema.Struct({ lufs: Schema.Finite, gain: Schema.Finite }))
})
export type PresetConfig = typeof PresetConfig.Type

export const Preset = Schema.Struct({
  id: PresetId,
  name: Schema.String,
  isDefault: Schema.Boolean,
  config: PresetConfig,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString
})
export type Preset = typeof Preset.Type

export class PresetNotFound extends Schema.TaggedError<PresetNotFound>()("PresetNotFound", {
  id: PresetId
}) {}

export class PresetNameTaken extends Schema.TaggedError<PresetNameTaken>()("PresetNameTaken", {
  presetName: Schema.String
}) {}

export class PresetIsDefault extends Schema.TaggedError<PresetIsDefault>()("PresetIsDefault", {
  id: PresetId
}) {}

// A style edit the server refused, with every problem it found ("caption position must be 0–1").
export class PresetInvalid extends Schema.TaggedError<PresetInvalid>()("PresetInvalid", {
  problems: Schema.Array(Schema.String)
}) {}

export class PresetsRpcs extends RpcGroup.make(
  Rpc.make("ListPresets", { success: Schema.Array(Preset) }),
  Rpc.make("GetPreset", { payload: { id: PresetId }, success: Preset, error: PresetNotFound }),
  Rpc.make("CreatePreset", {
    payload: { name: Schema.String, config: PresetConfig },
    success: Preset,
    error: PresetNameTaken
  }),
  Rpc.make("SetDefaultPreset", { payload: { id: PresetId }, success: Preset, error: PresetNotFound }),
  // Replaces a style's settings after checking them; refused with every problem found.
  Rpc.make("UpdatePreset", {
    payload: { id: PresetId, config: PresetConfig },
    success: Preset,
    error: Schema.Union([PresetNotFound, PresetInvalid])
  }),
  Rpc.make("RenamePreset", {
    payload: { id: PresetId, name: Schema.String },
    success: Preset,
    error: Schema.Union([PresetNotFound, PresetNameTaken, PresetInvalid])
  }),
  // The default preset can't be deleted; make another one the default first.
  Rpc.make("DeletePreset", {
    payload: { id: PresetId },
    success: Schema.Boolean,
    error: PresetIsDefault
  })
) {}
