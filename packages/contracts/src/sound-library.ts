import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Rights } from "./rights.ts"

export const SoundEffectId = Schema.String.pipe(Schema.brand("SoundEffectId"))
export type SoundEffectId = typeof SoundEffectId.Type

// What a sound effect is for. The sound stage picks by category and rotates through its variants.
export const SoundCategory = Schema.Literals([
  "whoosh", // scene changes, fast zoom or crop moves
  "pop", // highlighted caption words, a number or result appearing
  "click", // UI on screen
  "tick", // lists, counting up
  "typing", // text being typed on screen
  "error", // something failing
  "riser", // building into the payoff or drop
  "impact", // the drop, the big reveal
  "boom", // a heavy sub hit for a shock moment
  "scratch", // record scratch on a setback ("But…")
  "ding", // success, "it worked"
  "swoosh-reverse", // rewind or flashback
  "glitch", // weird or broken moments
  "camera" // shutter on a freeze frame
])
export type SoundCategory = typeof SoundCategory.Type

export const SoundEffectOrigin = Schema.Union([
  Schema.TaggedStruct("Bundled", {}),
  Schema.TaggedStruct("Upload", { file: Schema.String }),
  // kept so the effect can be regenerated or varied
  Schema.TaggedStruct("Generated", {
    provider: Schema.Literal("elevenlabs"),
    prompt: Schema.String,
    settings: Schema.Record(Schema.String, Schema.Unknown)
  })
])
export type SoundEffectOrigin = typeof SoundEffectOrigin.Type

export const SoundEffect = Schema.Struct({
  id: SoundEffectId,
  category: SoundCategory,
  // "whoosh-soft-02"
  name: Schema.String,
  // relative to ~/.viral/sounds/
  path: Schema.String,
  durationS: Schema.Finite,
  loudnessLufs: Schema.NullOr(Schema.Finite),
  origin: SoundEffectOrigin,
  rights: Rights,
  createdAt: Schema.DateTimeUtcFromString
})
export type SoundEffect = typeof SoundEffect.Type

export class SoundEffectNotFound extends Schema.TaggedError<SoundEffectNotFound>()("SoundEffectNotFound", {
  id: SoundEffectId
}) {}

// A sound effect couldn't be made: `code` "no-key", "http", "response", "limit" (ElevenLabs' own words in `message`).
export class SoundError extends Schema.TaggedError<SoundError>()("SoundError", {
  code: Schema.String,
  message: Schema.String
}) {}

// The sound-effect generator's limits (ElevenLabs Sound Effects).
export const SOUND_MIN_S = 0.5
export const SOUND_MAX_S = 30
export const SOUND_MAX_TAKES = 4

// What one take is expected to cost in ElevenLabs credits: 40 a second when you set the length, 200 when ElevenLabs
// picks it (its published rates; the bill it reports is what's recorded).
export const soundEffectCredits = (durationS: number | null) => durationS === null ? 200 : Math.ceil(durationS * 40)

export const GenerateSoundEffectRequest = Schema.Struct({
  prompt: Schema.String,
  category: SoundCategory,
  // null = ElevenLabs picks the length
  durationS: Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: SOUND_MIN_S, maximum: SOUND_MAX_S }))),
  loop: Schema.Boolean,
  // 0–1: how closely it follows the prompt ("Follow the prompt")
  promptInfluence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  takes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: SOUND_MAX_TAKES })),
  // the short it was made from, for Settings › Usage (the sound itself goes to the library, not the short)
  projectId: Schema.NullOr(Schema.String)
})
export type GenerateSoundEffectRequest = typeof GenerateSoundEffectRequest.Type

export class SoundLibraryRpcs extends RpcGroup.make(
  Rpc.make("ListSoundEffects", { payload: { category: Schema.NullOr(SoundCategory) }, success: Schema.Array(SoundEffect) }),
  Rpc.make("GetSoundEffect", { payload: { id: SoundEffectId }, success: SoundEffect, error: SoundEffectNotFound }),
  // Makes sound effects with ElevenLabs and keeps every take in the sound library (origin Generated).
  Rpc.make("GenerateSoundEffect", { payload: GenerateSoundEffectRequest.fields, success: Schema.Array(SoundEffect), error: SoundError }),
  // Removes a sound you made or added, and its file; bundled sounds stay.
  Rpc.make("DeleteSoundEffect", { payload: { id: SoundEffectId }, success: Schema.Boolean, error: SoundError })
) {}
