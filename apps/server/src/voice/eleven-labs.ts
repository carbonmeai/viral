import { type Voice, VoiceError } from "@viral/contracts"
import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { Secrets } from "../secrets/secrets.ts"

const API = "https://api.elevenlabs.io"

const VoicesResponse = Schema.Struct({
  voices: Schema.Array(Schema.Struct({
    voice_id: Schema.String,
    name: Schema.String,
    category: Schema.optionalKey(Schema.NullOr(Schema.String)),
    description: Schema.optionalKey(Schema.NullOr(Schema.String)),
    labels: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
    preview_url: Schema.optionalKey(Schema.NullOr(Schema.String))
  }))
})

export interface SpeechRequest {
  readonly voiceId: string
  readonly model: string
  readonly text: string
}

export interface Speech {
  // mp3, 44.1 kHz
  readonly audio: Uint8Array
  // characters billed for it
  readonly characters: number
}

// The ElevenLabs API, wrapped once: the voices you can narrate with, and text to speech. The key comes from
// Secrets (ELEVENLABS_API_KEY, or the Keychain entry viral/elevenlabs).
export class ElevenLabs extends Context.Service<ElevenLabs, {
  readonly voices: Effect.Effect<ReadonlyArray<Voice>, VoiceError>
  speak(request: SpeechRequest): Effect.Effect<Speech, VoiceError>
}>()("@viral/server/voice/eleven-labs/ElevenLabs") {
  static readonly layer = Layer.effect(
    ElevenLabs,
    Effect.gen(function*() {
      const secrets = yield* Secrets
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      const fail = (code: string) => (error: { readonly message: string }) => new VoiceError({ code, message: error.message })

      const key = Effect.flatMap(secrets.get("elevenlabs"), Option.match({
        onNone: () =>
          Effect.fail(new VoiceError({
            code: "no-key",
            message: "add an ElevenLabs API key (ELEVENLABS_API_KEY, or the macOS Keychain entry viral/elevenlabs)"
          })),
        onSome: (value) => Effect.succeed(Redacted.value(value))
      }))

      const voices = Effect.gen(function*() {
        const response = yield* http.execute(
          HttpClientRequest.get(`${API}/v1/voices`).pipe(HttpClientRequest.setHeader("xi-api-key", yield* key))
        ).pipe(Effect.flatMap((res) => res.json), Effect.timeout(Duration.seconds(30)), Effect.mapError(fail("http")))
        const decoded = yield* Schema.decodeUnknownEffect(VoicesResponse)(response).pipe(Effect.mapError(fail("response")))
        return decoded.voices.map((v): Voice => ({
          voiceId: v.voice_id,
          name: v.name,
          category: v.category ?? null,
          description: v.description ?? null,
          labels: v.labels ?? {},
          previewUrl: v.preview_url ?? null
        }))
      }).pipe(Effect.withSpan("ElevenLabs.voices"))

      const speak = Effect.fn("ElevenLabs.speak")(function*(request: SpeechRequest) {
        const res = yield* HttpClientRequest.post(`${API}/v1/text-to-speech/${request.voiceId}`).pipe(
          HttpClientRequest.setUrlParam("output_format", "mp3_44100_128"),
          HttpClientRequest.setHeader("xi-api-key", yield* key),
          HttpClientRequest.bodyJsonUnsafe({ text: request.text, model_id: request.model }),
          http.execute,
          Effect.timeout(Duration.minutes(5)),
          Effect.mapError(fail("http"))
        )
        const audio = new Uint8Array(yield* res.arrayBuffer.pipe(Effect.mapError(fail("http"))))
        // ElevenLabs reports what it billed; the text length is the fallback
        const billed = Number(res.headers["character-cost"])
        return { audio, characters: Number.isFinite(billed) ? billed : request.text.length }
      })

      return ElevenLabs.of({ voices, speak })
    })
  ).pipe(Layer.provide([Secrets.layer, FetchHttpClient.layer]))

  // For tests: `speak` returns `answer(request)` as the audio, billed at the text's length; no voices.
  static readonly replay = (answer: (request: SpeechRequest) => Uint8Array) =>
    Layer.succeed(ElevenLabs, ElevenLabs.of({
      voices: Effect.succeed([]),
      speak: Effect.fn("ElevenLabs.replay")((request: SpeechRequest) =>
        Effect.sync(() => ({ audio: answer(request), characters: request.text.length }))
      )
    }))
}
