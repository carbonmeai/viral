import { Context, DateTime, Effect, Layer } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"

// "Try a line" previews cost ElevenLabs characters too, so each one is recorded (voice_previews) for Settings › Usage.
// They belong to no run or short.
export class VoicePreviews extends Context.Service<VoicePreviews, {
  record(voiceId: string, model: string, characters: number): Effect.Effect<void>
}>()("@viral/server/voice/voice-previews/VoicePreviews") {
  static readonly layer = Layer.effect(
    VoicePreviews,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const random = yield* SecureRandom.SecureRandom
      const record = Effect.fn("VoicePreviews.record")(
        function*(voiceId: string, model: string, characters: number) {
          const id = yield* random.uuidV7()
          const now = DateTime.formatIso(yield* DateTime.now)
          yield* sql`
            INSERT INTO voice_previews (id, voice_id, model, characters, created_at)
            VALUES (${id}, ${voiceId}, ${model}, ${Math.round(characters)}, ${now})
          `
        },
        Effect.orDie
      )
      return VoicePreviews.of({ record })
    })
  ).pipe(Layer.provide([DatabaseLive, SecureRandom.layerWebCrypto]))
}
