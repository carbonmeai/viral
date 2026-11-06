import { type ExploreVoicesQuery, type ExploreVoicesResult, type LibraryVoice, type Voice, VoiceError } from "@viral/contracts"
import { Config, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { Secrets } from "../secrets/secrets.ts"

const API = "https://api.elevenlabs.io"
// a page of the shared library
const PAGE_SIZE = 30

const SharedVoicesResponse = Schema.Struct({
  voices: Schema.Array(Schema.Struct({
    voice_id: Schema.String,
    public_owner_id: Schema.String,
    name: Schema.String,
    description: Schema.optionalKey(Schema.NullOr(Schema.String)),
    language: Schema.optionalKey(Schema.NullOr(Schema.String)),
    locale: Schema.optionalKey(Schema.NullOr(Schema.String)),
    accent: Schema.optionalKey(Schema.NullOr(Schema.String)),
    gender: Schema.optionalKey(Schema.NullOr(Schema.String)),
    age: Schema.optionalKey(Schema.NullOr(Schema.String)),
    use_case: Schema.optionalKey(Schema.NullOr(Schema.String)),
    category: Schema.optionalKey(Schema.NullOr(Schema.String)),
    preview_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
    date_unix: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
    cloned_by_count: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
    featured: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    verified_languages: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({ language: Schema.String }))))
  })),
  has_more: Schema.Boolean,
  total_count: Schema.optionalKey(Schema.NullOr(Schema.Finite))
})

// ElevenLabs' error body: `{detail: {status, message}}` or `{detail: "message"}`.
const ErrorBody = Schema.Struct({
  detail: Schema.Union([Schema.String, Schema.Struct({ status: Schema.optionalKey(Schema.String), message: Schema.optionalKey(Schema.String) })])
})

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
  // the shared voice library, marking the voices already among yours
  explore(query: ExploreVoicesQuery): Effect.Effect<ExploreVoicesResult, VoiceError>
  // adds a library voice to yours; fails with code "limit" when the plan has no voice slot left
  addShared(publicOwnerId: string, voiceId: string, name: string | null): Effect.Effect<Voice, VoiceError>
  // removes a voice you added; ElevenLabs' premade voices fail with "not-removable"
  remove(voiceId: string): Effect.Effect<boolean, VoiceError>
}>()("@viral/server/voice/eleven-labs/ElevenLabs") {
  static readonly layer = Layer.effect(
    ElevenLabs,
    Effect.gen(function*() {
      const secrets = yield* Secrets
      const client = yield* HttpClient.HttpClient
      const http = client.pipe(HttpClient.filterStatusOk)
      // another address only for tests
      const api = yield* Config.String("ELEVENLABS_API_URL").pipe(Config.withDefault(API), Effect.orDie)
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
          HttpClientRequest.get(`${api}/v1/voices`).pipe(HttpClientRequest.setHeader("xi-api-key", yield* key))
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
        const res = yield* HttpClientRequest.post(`${api}/v1/text-to-speech/${request.voiceId}`).pipe(
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

      // A call whose failure carries ElevenLabs' own explanation; a voice-slot limit gets the code "limit".
      const call = Effect.fn("ElevenLabs.call")(function*(request: HttpClientRequest.HttpClientRequest) {
        const res = yield* client.execute(request.pipe(HttpClientRequest.setHeader("xi-api-key", yield* key))).pipe(
          Effect.timeout(Duration.seconds(30)),
          Effect.mapError(fail("http"))
        )
        if (res.status >= 200 && res.status < 300) return res
        return yield* refused(res)
      })
      const refused = Effect.fn("ElevenLabs.refused")(function*(res: HttpClientResponse.HttpClientResponse) {
        const body = yield* res.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ErrorBody)), Effect.option)
        const detail = Option.map(body, (b) => b.detail)
        const status = Option.getOrElse(Option.map(detail, (d) => typeof d === "string" ? "" : d.status ?? ""), () => "")
        const message = Option.getOrElse(
          Option.map(detail, (d) => typeof d === "string" ? d : d.message ?? d.status ?? ""),
          () => ""
        )
        const limit = /limit/i.test(status) || /voice slots?|voice limit/i.test(message)
        return yield* new VoiceError({
          code: limit ? "limit" : "http",
          message: limit
            ? `Your ElevenLabs plan has no voice slot left${message === "" ? "" : ` (${message})`}. Remove a voice you don't use, or upgrade your plan.`
            : `ElevenLabs refused it (${res.status})${message === "" ? "" : `: ${message}`}`
        })
      })

      const explore = Effect.fn("ElevenLabs.explore")(function*(query: ExploreVoicesQuery) {
        let request = HttpClientRequest.get(`${api}/v1/shared-voices`).pipe(
          HttpClientRequest.setUrlParam("page_size", String(PAGE_SIZE)),
          HttpClientRequest.setUrlParam("page", String(query.page)),
          HttpClientRequest.setUrlParam("sort", query.sort)
        )
        const params: ReadonlyArray<readonly [string, string | null]> = [
          ["search", query.search === null || query.search.trim() === "" ? null : query.search.trim()],
          ["language", query.language],
          ["use_cases", query.useCase],
          ["gender", query.gender],
          ["age", query.age]
        ]
        for (const [name, value] of params) {
          if (value !== null) request = request.pipe(HttpClientRequest.setUrlParam(name, value))
        }
        const [res, mine] = yield* Effect.all([call(request), voices], { concurrency: 2 })
        const decoded = yield* res.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(SharedVoicesResponse)), Effect.mapError(fail("response")))
        const yours = new Set(mine.map((v) => v.voiceId))
        return {
          voices: decoded.voices.map((v): LibraryVoice => ({
            voiceId: v.voice_id,
            publicOwnerId: v.public_owner_id,
            name: v.name,
            description: v.description ?? null,
            language: v.language ?? null,
            locale: v.locale ?? null,
            accent: v.accent ?? null,
            gender: v.gender ?? null,
            age: v.age ?? null,
            extraLanguages: Math.max(0, new Set((v.verified_languages ?? []).map((l) => l.language)).size - 1),
            createdAt: v.date_unix ?? null,
            users: Math.round(v.cloned_by_count ?? 0),
            useCase: v.use_case ?? null,
            category: v.category ?? null,
            previewUrl: v.preview_url ?? null,
            featured: v.featured ?? false,
            inMyVoices: yours.has(v.voice_id)
          })),
          total: Math.round(decoded.total_count ?? decoded.voices.length),
          hasMore: decoded.has_more,
          page: query.page
        } satisfies ExploreVoicesResult
      })

      const addShared = Effect.fn("ElevenLabs.addShared")(function*(publicOwnerId: string, voiceId: string, name: string | null) {
        yield* call(HttpClientRequest.post(`${api}/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ new_name: name ?? voiceId })
        ))
        const added = (yield* voices).find((v) => v.voiceId === voiceId)
        if (added !== undefined) return added
        return yield* new VoiceError({ code: "response", message: "ElevenLabs added the voice but doesn't list it yet; refresh in a moment" })
      })

      const remove = Effect.fn("ElevenLabs.remove")(function*(voiceId: string) {
        const voice = (yield* voices).find((v) => v.voiceId === voiceId)
        if (voice === undefined) return false
        if (voice.category === "premade") {
          return yield* new VoiceError({ code: "not-removable", message: `${voice.name} is one of ElevenLabs' own voices and can't be removed` })
        }
        yield* call(HttpClientRequest.delete(`${api}/v1/voices/${encodeURIComponent(voiceId)}`))
        return true
      })

      return ElevenLabs.of({ voices, speak, explore, addShared, remove })
    })
  ).pipe(Layer.provide([Secrets.layer, FetchHttpClient.layer]))

  // For tests: `speak` returns `answer(request)` as the audio, billed at the text's length; no voices.
  static readonly replay = (answer: (request: SpeechRequest) => Uint8Array) =>
    Layer.succeed(ElevenLabs, ElevenLabs.of({
      voices: Effect.succeed([]),
      explore: Effect.fn("ElevenLabs.replay.explore")((query: ExploreVoicesQuery) =>
        Effect.succeed({ voices: [], total: 0, hasMore: false, page: query.page })
      ),
      addShared: Effect.fn("ElevenLabs.replay.addShared")(() =>
        Effect.fail(new VoiceError({ code: "http", message: "no ElevenLabs in this test" }))
      ),
      remove: Effect.fn("ElevenLabs.replay.remove")(() => Effect.succeed(false)),
      speak: Effect.fn("ElevenLabs.replay")((request: SpeechRequest) =>
        Effect.sync(() => ({ audio: answer(request), characters: request.text.length }))
      )
    }))
}
