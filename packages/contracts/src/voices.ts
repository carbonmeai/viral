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

// What a library voice is made for (ElevenLabs' use cases); narration is what a short's narrator needs.
export const VoiceUseCase = Schema.Literals([
  "narrative_story",
  "conversational",
  "characters_animation",
  "social_media",
  "informative_educational",
  "advertisement",
  "entertainment_tv"
])
export type VoiceUseCase = typeof VoiceUseCase.Type

export const VoiceSort = Schema.Literals(["trending", "created_date", "cloned_by_count", "usage_character_count_1y"])
export type VoiceSort = typeof VoiceSort.Type

// A voice in ElevenLabs' shared library: anyone's voice you can add to your own and narrate with.
export const LibraryVoice = Schema.Struct({
  voiceId: Schema.String,
  // the owner's public id, needed to add the voice to yours
  publicOwnerId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  locale: Schema.NullOr(Schema.String),
  accent: Schema.NullOr(Schema.String),
  gender: Schema.NullOr(Schema.String),
  age: Schema.NullOr(Schema.String),
  // other languages it's verified in, beyond its own
  extraLanguages: Schema.Int,
  // when it was shared, in Unix seconds
  createdAt: Schema.NullOr(Schema.Finite),
  // how many people added it
  users: Schema.Int,
  useCase: Schema.NullOr(Schema.String),
  category: Schema.NullOr(Schema.String),
  // ElevenLabs' own sample, free to play
  previewUrl: Schema.NullOr(Schema.String),
  featured: Schema.Boolean,
  // already among your voices
  inMyVoices: Schema.Boolean
})
export type LibraryVoice = typeof LibraryVoice.Type

export const ExploreVoicesQuery = Schema.Struct({
  search: Schema.NullOr(Schema.String),
  // an ISO code, e.g. "en"
  language: Schema.NullOr(Schema.String),
  useCase: Schema.NullOr(VoiceUseCase),
  gender: Schema.NullOr(Schema.Literals(["male", "female", "neutral"])),
  age: Schema.NullOr(Schema.Literals(["young", "middle_aged", "old"])),
  sort: VoiceSort,
  // 0-based
  page: Schema.Int
})
export type ExploreVoicesQuery = typeof ExploreVoicesQuery.Type

export const ExploreVoicesResult = Schema.Struct({
  voices: Schema.Array(LibraryVoice),
  total: Schema.Int,
  hasMore: Schema.Boolean,
  page: Schema.Int
})
export type ExploreVoicesResult = typeof ExploreVoicesResult.Type

// `code`: "no-key", "http", "response", "audio"; "limit" when your plan has no voice slot left;
// "not-removable" for ElevenLabs' own premade voices.
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
  // ElevenLabs' shared voice library, filtered and paged (free to browse).
  Rpc.make("ExploreVoices", { payload: ExploreVoicesQuery.fields, success: ExploreVoicesResult, error: VoiceError }),
  // Adds a library voice to your voices (uses one of your plan's voice slots).
  Rpc.make("AddLibraryVoice", {
    payload: { publicOwnerId: Schema.String, voiceId: Schema.String, name: Schema.NullOr(Schema.String) },
    success: Voice,
    error: VoiceError
  }),
  // Removes a voice you added; ElevenLabs' premade voices can't be removed.
  Rpc.make("RemoveVoice", { payload: { voiceId: Schema.String }, success: Schema.Boolean, error: VoiceError }),
  // Speaks a sample line in a voice (costs its characters) and returns the mp3's path on the server.
  Rpc.make("PreviewVoice", {
    payload: { voiceId: Schema.String, text: Schema.NullOr(Schema.String) },
    success: Schema.Struct({ path: Schema.String, characters: Schema.Int }),
    error: VoiceError
  })
) {}
