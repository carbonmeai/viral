import { type ElevenLabsPlan, type ExploreVoicesQuery, type ExploreVoicesResult, type LibraryVoice, soundEffectCredits, type Voice, VoiceError } from "@viral/contracts"
import { Config, Context, DateTime, Duration, Effect, Exit, Layer, Option, Redacted, Schema } from "effect"
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

// GET /v1/user/subscription, the parts the usage page shows. The key needs the User › Read permission.
const SubscriptionResponse = Schema.Struct({
  tier: Schema.String,
  character_count: Schema.Finite,
  character_limit: Schema.Finite,
  next_character_count_reset_unix: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  currency: Schema.optionalKey(Schema.NullOr(Schema.String)),
  billing_period: Schema.optionalKey(Schema.NullOr(Schema.String)),
  next_invoice: Schema.optionalKey(Schema.NullOr(Schema.Struct({ amount_due_cents: Schema.optionalKey(Schema.NullOr(Schema.Finite)) })))
})

// What a character costs on the plan, from its next invoice: a monthly price over the month's characters (an annual
// price is spread over twelve months). Unknown (null) without an invoice, in another currency, or on a free plan.
export const usdPerCharacter = (sub: typeof SubscriptionResponse.Type): number | null => {
  const cents = sub.next_invoice?.amount_due_cents ?? null
  const currency = (sub.currency ?? "usd").toLowerCase()
  if (cents === null || cents <= 0 || currency !== "usd" || sub.character_limit <= 0) return null
  const monthly = sub.billing_period === "annual_period" ? cents / 12 : cents
  return monthly / 100 / sub.character_limit
}

// POST /v1/text-to-voice/design: three voices made from a description, each speaking the same line.
const DesignResponse = Schema.Struct({
  previews: Schema.Array(Schema.Struct({
    audio_base_64: Schema.String,
    generated_voice_id: Schema.String,
    media_type: Schema.optionalKey(Schema.NullOr(Schema.String)),
    duration_secs: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
    language: Schema.optionalKey(Schema.NullOr(Schema.String))
  })),
  text: Schema.optionalKey(Schema.NullOr(Schema.String))
})

// POST /v1/text-to-voice: the voice it saved.
const SavedVoiceResponse = Schema.Struct({ voice_id: Schema.String })

// The models behind the generators (Library › Create). Voice design makes voices from a description; sound effects
// make any sound that isn't speech. ElevenLabs' skill recommends SFX v3 over the API's default v2.
export const VOICE_DESIGN_MODEL = "eleven_ttv_v3"
export const SOUND_EFFECT_MODEL = "eleven_text_to_sound_v3"

export interface DesignRequest {
  readonly description: string
  // the line each voice speaks: 100–1000 characters
  readonly text: string
}

export interface DesignedVoice {
  // ElevenLabs' id for the preview, which saving turns into a voice of yours
  readonly generatedVoiceId: string
  // mp3
  readonly audio: Uint8Array
  readonly durationS: number | null
  readonly language: string | null
}

export interface SoundRequest {
  readonly text: string
  // 0.5–30 s; null = ElevenLabs picks
  readonly durationS: number | null
  readonly loop: boolean
  // 0–1: how closely it follows the prompt
  readonly promptInfluence: number
}

// What a billed call reported: the `character-cost` header (characters or credits), else `fallback`.
const billedOf = (res: HttpClientResponse.HttpClientResponse, fallback: number) => {
  const billed = Number(res.headers["character-cost"])
  return Number.isFinite(billed) ? billed : fallback
}

// One image from the Image & Video API (POST /v1/flows/image, then GET until it's done): a prompt, real reference
// images in the order the prompt numbers them, and the model's settings.
export interface ImageRequest {
  readonly model: string
  readonly prompt: string
  readonly images: ReadonlyArray<{ readonly data: Uint8Array; readonly mimeType: string }>
  readonly aspectRatio: string
  readonly resolution: string
  readonly quality: string
}

export interface GeneratedImage {
  readonly data: Uint8Array
  readonly mimeType: string
  // the credits ElevenLabs reported for it (the character-cost header), when it did
  readonly credits: number | null
}

const ImageGeneration = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["pending", "generating", "completed", "failed"]),
  content_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  content_mime_type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  failure_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  error_message: Schema.optionalKey(Schema.NullOr(Schema.String))
})

// how often a pending image is asked about (ElevenLabs suggests every 2 s), and how long one may take
const IMAGE_POLL = Duration.seconds(2)
const IMAGE_TIMEOUT = Duration.minutes(6)

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
  // the plan's characters used and left this period, read-only; kept for a minute (a few seconds when unavailable)
  readonly plan: Effect.Effect<ElevenLabsPlan>
  // three voices made from a description, as previews: nothing is added to your account
  design(request: DesignRequest): Effect.Effect<{ readonly text: string; readonly previews: ReadonlyArray<DesignedVoice>; readonly characters: number }, VoiceError>
  // keeps one designed preview as a voice of yours (uses a voice slot; code "limit" when none is left)
  saveDesigned(generatedVoiceId: string, name: string, description: string): Effect.Effect<Voice, VoiceError>
  // a sound effect from a description (mp3), and the characters or credits it billed
  soundEffect(request: SoundRequest): Effect.Effect<Speech, VoiceError>
  // whether images can be made: an ElevenLabs key is set (the API also needs a Pro plan or above)
  readonly imagesReady: Effect.Effect<boolean>
  // one image; a refusal fails with ElevenLabs' reason as the code ("moderated", "timeout", "model_error"…) and its
  // own message (failed generations aren't charged)
  image(request: ImageRequest): Effect.Effect<GeneratedImage, VoiceError>
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
        // ElevenLabs reports what it billed (the plan's characters, which can be fewer than the text's: 0.4 a character
        // on Viral's account on 10 Nov); the text length is the fallback
        return { audio, characters: billedOf(res, request.text.length) }
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

      const readPlan = Effect.gen(function*() {
        const res = yield* call(HttpClientRequest.get(`${api}/v1/user/subscription`))
        const sub = yield* res.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(SubscriptionResponse)), Effect.mapError(fail("response")))
        const reset = sub.next_character_count_reset_unix ?? null
        return {
          _tag: "Plan",
          tier: sub.tier,
          charactersUsed: Math.round(sub.character_count),
          characterLimit: Math.round(sub.character_limit),
          resetsAt: reset === null ? null : DateTime.formatIso(DateTime.makeUnsafe(reset * 1000)),
          usdPerCharacter: usdPerCharacter(sub),
          checkedAt: DateTime.formatIso(yield* DateTime.now)
        } satisfies ElevenLabsPlan
      }).pipe(
        Effect.catch((error: VoiceError): Effect.Effect<ElevenLabsPlan> =>
          Effect.succeed({
            _tag: "Unavailable",
            reason: error.code === "no-key" ? "no-key" : /permission|user_read/i.test(error.message) ? "no-permission" : "failed",
            message: error.message
          })
        ),
        Effect.withSpan("ElevenLabs.plan")
      )
      const plan = yield* Effect.cachedWithTTL(
        readPlan,
        (exit: Exit.Exit<ElevenLabsPlan>) => Exit.isSuccess(exit) && exit.value._tag === "Plan" ? Duration.minutes(1) : Duration.seconds(5)
      )

      // Generators can take a while (three voices, a long sound), so they get longer than the other calls.
      const generate = Effect.fn("ElevenLabs.generate")(function*(request: HttpClientRequest.HttpClientRequest) {
        const res = yield* client.execute(request.pipe(HttpClientRequest.setHeader("xi-api-key", yield* key))).pipe(
          Effect.timeout(Duration.minutes(3)),
          Effect.mapError(fail("http"))
        )
        if (res.status >= 200 && res.status < 300) return res
        return yield* refused(res)
      })

      const design = Effect.fn("ElevenLabs.design")(function*(request: DesignRequest) {
        const res = yield* generate(HttpClientRequest.post(`${api}/v1/text-to-voice/design`).pipe(
          HttpClientRequest.setUrlParam("output_format", "mp3_44100_128"),
          HttpClientRequest.bodyJsonUnsafe({ voice_description: request.description, model_id: VOICE_DESIGN_MODEL, text: request.text })
        ))
        const decoded = yield* res.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(DesignResponse)), Effect.mapError(fail("response")))
        return {
          text: decoded.text ?? request.text,
          previews: decoded.previews.map((p): DesignedVoice => ({
            generatedVoiceId: p.generated_voice_id,
            audio: Uint8Array.from(Buffer.from(p.audio_base_64, "base64")),
            durationS: p.duration_secs ?? null,
            language: p.language ?? null
          })),
          characters: billedOf(res, request.text.length)
        }
      })

      const saveDesigned = Effect.fn("ElevenLabs.saveDesigned")(function*(generatedVoiceId: string, name: string, description: string) {
        const res = yield* call(HttpClientRequest.post(`${api}/v1/text-to-voice`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ voice_name: name, voice_description: description, generated_voice_id: generatedVoiceId })
        ))
        const saved = yield* res.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(SavedVoiceResponse)), Effect.mapError(fail("response")))
        const voice = (yield* voices).find((v) => v.voiceId === saved.voice_id)
        return voice ?? { voiceId: saved.voice_id, name, category: "generated", description, labels: {}, previewUrl: null }
      })

      const soundEffect = Effect.fn("ElevenLabs.soundEffect")(function*(request: SoundRequest) {
        const res = yield* generate(HttpClientRequest.post(`${api}/v1/sound-generation`).pipe(
          HttpClientRequest.setUrlParam("output_format", "mp3_44100_128"),
          HttpClientRequest.bodyJsonUnsafe({
            text: request.text,
            model_id: SOUND_EFFECT_MODEL,
            duration_seconds: request.durationS,
            prompt_influence: request.promptInfluence,
            loop: request.loop
          })
        ))
        const audio = new Uint8Array(yield* res.arrayBuffer.pipe(Effect.mapError(fail("http"))))
        return { audio, characters: billedOf(res, soundEffectCredits(request.durationS)) }
      })

      const imagesReady = Effect.map(secrets.get("elevenlabs"), Option.isSome)

      const readGeneration = (res: HttpClientResponse.HttpClientResponse) =>
        res.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ImageGeneration)), Effect.mapError(fail("response")))

      const image = Effect.fn("ElevenLabs.image")(function*(request: ImageRequest) {
        const res = yield* call(HttpClientRequest.post(`${api}/v1/flows/image`).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            model_id: request.model,
            prompt: request.prompt,
            aspect_ratio: request.aspectRatio,
            resolution: request.resolution,
            quality: request.quality,
            images: request.images.map((i) => ({ type: "inline_base64", content_base64: Buffer.from(i.data).toString("base64"), mime_type: i.mimeType }))
          })
        )).pipe(
          // the Image & Video API needs a Pro plan or above
          Effect.mapError((error) =>
            /\(402\)/.test(error.message)
              ? new VoiceError({ code: "plan", message: "Your ElevenLabs plan can't make images (its Image & Video API needs Pro or above)." })
              : error
          )
        )
        const credits = Number(res.headers["character-cost"])
        let generation = yield* readGeneration(res)
        // asked about every couple of seconds until it's done or failed
        const poll = Effect.gen(function*() {
          while (generation.status === "pending" || generation.status === "generating") {
            yield* Effect.sleep(IMAGE_POLL)
            generation = yield* readGeneration(yield* call(HttpClientRequest.get(`${api}/v1/flows/image/${encodeURIComponent(generation.id)}`)))
          }
          return generation
        })
        const done = yield* poll.pipe(
          Effect.timeoutOrElse({
            duration: IMAGE_TIMEOUT,
            orElse: () => Effect.fail(new VoiceError({ code: "timeout", message: "the image took too long" }))
          })
        )
        if (done.status === "failed") {
          return yield* new VoiceError({ code: done.failure_reason ?? "failed", message: done.error_message ?? "the image model couldn't make it" })
        }
        if (done.content_url == null) return yield* new VoiceError({ code: "response", message: "the finished image has no address" })
        // a signed storage address: fetched without the key
        const file = yield* http.execute(HttpClientRequest.get(done.content_url)).pipe(
          Effect.flatMap((r) => r.arrayBuffer),
          Effect.timeout(Duration.minutes(2)),
          Effect.mapError(fail("http"))
        )
        return { data: new Uint8Array(file), mimeType: done.content_mime_type ?? "image/png", credits: Number.isFinite(credits) ? credits : null }
      })

      return ElevenLabs.of({ voices, speak, explore, addShared, remove, plan, design, saveDesigned, soundEffect, imagesReady, image })
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
      plan: Effect.succeed({ _tag: "Unavailable", reason: "failed", message: "no ElevenLabs in this test" }),
      speak: Effect.fn("ElevenLabs.replay")((request: SpeechRequest) =>
        Effect.sync(() => ({ audio: answer(request), characters: request.text.length }))
      ),
      design: Effect.fn("ElevenLabs.replay.design")(() => Effect.fail(new VoiceError({ code: "http", message: "no ElevenLabs in this test" }))),
      saveDesigned: Effect.fn("ElevenLabs.replay.saveDesigned")(() => Effect.fail(new VoiceError({ code: "http", message: "no ElevenLabs in this test" }))),
      soundEffect: Effect.fn("ElevenLabs.replay.soundEffect")(() => Effect.fail(new VoiceError({ code: "http", message: "no ElevenLabs in this test" }))),
      // no images in a replay: the thumbnail stage draws its basic thumbnail
      imagesReady: Effect.succeed(false),
      image: Effect.fn("ElevenLabs.replay.image")(() => Effect.fail(new VoiceError({ code: "http", message: "no ElevenLabs in this test" })))
    }))
}
