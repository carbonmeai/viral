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

export class SoundLibraryRpcs extends RpcGroup.make(
  Rpc.make("ListSoundEffects", { payload: { category: Schema.NullOr(SoundCategory) }, success: Schema.Array(SoundEffect) }),
  Rpc.make("GetSoundEffect", { payload: { id: SoundEffectId }, success: SoundEffect, error: SoundEffectNotFound })
) {}
