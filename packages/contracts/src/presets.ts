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
  captions: Schema.Struct({
    // false when the short is finished in an editor (e.g. CapCut) from the mp4 + srt
    enabled: Schema.Boolean,
    y: Schema.Finite,
    lowercase: Schema.Boolean
  }),
  music: Schema.Struct({
    gain: Schema.Finite,
    dropGain: Schema.Finite,
    duckRatio: Schema.Finite,
    duckThreshold: Schema.Finite
  }),
  loudnessLufs: Schema.Finite
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

export class PresetsRpcs extends RpcGroup.make(
  Rpc.make("ListPresets", { success: Schema.Array(Preset) }),
  Rpc.make("GetPreset", { payload: { id: PresetId }, success: Preset, error: PresetNotFound }),
  Rpc.make("CreatePreset", {
    payload: { name: Schema.String, config: PresetConfig },
    success: Preset,
    error: PresetNameTaken
  }),
  Rpc.make("SetDefaultPreset", { payload: { id: PresetId }, success: Preset, error: PresetNotFound }),
  // The default preset can't be deleted; make another one the default first.
  Rpc.make("DeletePreset", {
    payload: { id: PresetId },
    success: Schema.Boolean,
    error: PresetIsDefault
  })
) {}
