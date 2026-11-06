import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

// An ElevenLabs voice you can narrate with: your own and the library voices you saved.
export const Voice = Schema.Struct({
  voiceId: Schema.String,
  name: Schema.String,
  // premade · cloned · generated · professional
  category: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  // accent, age, gender, use case…
  labels: Schema.Record(Schema.String, Schema.String),
  // ElevenLabs' own sample, free to play
  previewUrl: Schema.NullOr(Schema.String)
})
export type Voice = typeof Voice.Type

// `code`: "no-key", "http", "response", "audio".
export class VoiceError extends Schema.TaggedError<VoiceError>()("VoiceError", {
  code: Schema.String,
  message: Schema.String
}) {}

// What the voice stage made: the take and how it was paced.
export const Voiceover = Schema.Struct({
  voiceId: Schema.String,
  model: Schema.String,
  text: Schema.String,
  // ElevenLabs characters spent on this take
  characters: Schema.Int,
  // words per second of the raw take, the atempo applied, and the pace after it
  rawPace: Schema.Finite,
  atempo: Schema.Finite,
  pace: Schema.Finite,
  durationS: Schema.Finite
})
export type Voiceover = typeof Voiceover.Type

export class VoicesRpcs extends RpcGroup.make(
  Rpc.make("ListVoices", { success: Schema.Array(Voice), error: VoiceError }),
  // Speaks a sample line in a voice (costs its characters) and returns the mp3's path on the server.
  Rpc.make("PreviewVoice", {
    payload: { voiceId: Schema.String, text: Schema.NullOr(Schema.String) },
    success: Schema.Struct({ path: Schema.String, characters: Schema.Int }),
    error: VoiceError
  })
) {}
