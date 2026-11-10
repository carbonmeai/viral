import { type GenerateSoundEffectRequest, type SoundEffect, SoundError } from "@viral/contracts"
import { Effect } from "effect"
import { UsageRecords } from "../usage/usage-records.ts"
import { ElevenLabs, SOUND_EFFECT_MODEL } from "../voice/eleven-labs.ts"
import { SoundLibrary, soundStem } from "./sound-library.ts"

// How long an mp3 at 128 kb/s plays, from its size (ElevenLabs' mp3_44100_128 is constant bit rate).
export const mp3Seconds = (bytes: number) => Math.round((bytes * 8 / 128_000) * 100) / 100

// The sound-effect generator (Library › Create › Sound effect): each take is made by ElevenLabs, billed to Settings ›
// Usage (step "sound-effect", under the short it was made from) the moment it's made, and kept in the sound library
// with its prompt and settings (origin Generated). Placing a sound on a short waits for the sound-design plan.
export const generateSoundEffects = Effect.fn("generateSoundEffects")(function*(request: GenerateSoundEffectRequest) {
  const eleven = yield* ElevenLabs
  const library = yield* SoundLibrary
  const usage = yield* UsageRecords
  const prompt = request.prompt.trim()
  if (prompt === "") return yield* new SoundError({ code: "prompt", message: "Say what the sound should be." })
  const made: Array<SoundEffect> = []
  for (let take = 0; take < request.takes; take++) {
    const sound = yield* eleven.soundEffect({ text: prompt, durationS: request.durationS, loop: request.loop, promptInfluence: request.promptInfluence }).pipe(
      Effect.mapError((e) => new SoundError({ code: e.code, message: e.message }))
    )
    yield* usage.record({
      projectId: request.projectId,
      step: "sound-effect",
      provider: "elevenlabs",
      model: SOUND_EFFECT_MODEL,
      billing: "billed",
      characters: sound.characters
    })
    made.push(yield* library.add({
      category: request.category,
      stem: soundStem(prompt),
      audio: sound.audio,
      durationS: request.durationS ?? mp3Seconds(sound.audio.byteLength),
      origin: {
        _tag: "Generated",
        provider: "elevenlabs",
        prompt,
        settings: { model: SOUND_EFFECT_MODEL, durationS: request.durationS, loop: request.loop, promptInfluence: request.promptInfluence }
      },
      rights: "licensed"
    }))
  }
  return made
})
