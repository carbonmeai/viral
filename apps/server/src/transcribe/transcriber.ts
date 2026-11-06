import { NodeServices } from "@effect/platform-node"
import { Transcript, TranscriberChoice, type TranscriptProvider } from "@viral/contracts"
import { Config, Context, Duration, Effect, FileSystem, Layer, Option, Path, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { ScriptRunner } from "../script-runner/script-runner.ts"
import { Secrets } from "../secrets/secrets.ts"
import { TRANSCRIBER_KEY } from "../settings/app-settings.ts"
import { Settings } from "../settings/settings.ts"
import { GrokSttResponse, grokToTranscript } from "./grok-response.ts"

// `code`: "no-provider", "audio", "grok-http", "grok-response", or the Whisper script's own code.
export class TranscribeError extends Schema.TaggedError<TranscribeError>()("TranscribeError", {
  code: Schema.String,
  message: Schema.String
}) {}

// Reports progress: a percentage (null when unknown) and an optional message for the person watching.
type Progress = (pct: number | null, message?: string) => Effect.Effect<void>

export interface TranscribeResult {
  readonly provider: TranscriptProvider
  readonly language: string
  readonly segments: number
  readonly durationS: number
}

const GROK_STT_URL = "https://api.x.ai/v1/stt"
const GROK_MODEL = "grok-voice-transcribe-2.0"
const isAppleSilicon = process.platform === "darwin" && process.arch === "arm64"

const TranscriptJson = Schema.fromJsonString(Transcript)

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  return `${String(m).padStart(2, "0")}:${(t - m * 60).toFixed(2).padStart(5, "0")}`
}

// Same reading format the Whisper script writes.
const transcriptText = (transcript: Transcript) =>
  transcript.segments.map((s) => `[${fmt(s.start)} - ${fmt(s.end)}] ${s.text}`).join("\n") + "\n"

export interface ProviderInputs {
  // VIRAL_TRANSCRIBER, when set
  readonly environment: string | null
  // Settings › Transcription
  readonly setting: TranscriberChoice
  readonly hasXaiKey: boolean
  readonly appleSilicon: boolean
  // a stage's preference, used when it's available and nothing above forces a provider
  readonly prefer: TranscriptProvider | undefined
}

// Which provider transcribes: the environment variable, then your setting, then the stage's preference, then
// Grok when there's an xAI key, else local Whisper on Apple Silicon.
export const chooseProvider = (inputs: ProviderInputs): Effect.Effect<TranscriptProvider, TranscribeError> => {
  if (inputs.environment !== null) {
    return inputs.environment === "grok" || inputs.environment === "whisper-local"
      ? Effect.succeed(inputs.environment)
      : Effect.fail(new TranscribeError({ code: "no-provider", message: `unknown VIRAL_TRANSCRIBER=${inputs.environment}` }))
  }
  if (inputs.setting !== "auto") return Effect.succeed(inputs.setting)
  const available = (provider: TranscriptProvider) => provider === "grok" ? inputs.hasXaiKey : inputs.appleSilicon
  if (inputs.prefer !== undefined && available(inputs.prefer)) return Effect.succeed(inputs.prefer)
  if (inputs.hasXaiKey) return Effect.succeed("grok")
  if (inputs.appleSilicon) return Effect.succeed("whisper-local")
  return Effect.fail(new TranscribeError({
    code: "no-provider",
    message: "add an xAI API key (Settings › Accounts) to transcribe with Grok"
  }))
}

// Word-timed transcription into <outDir>/transcript.json (+ transcript.txt). Providers: Grok STT when an
// xAI key is available, otherwise local mlx-whisper on Apple Silicon. VIRAL_TRANSCRIBER=grok|whisper-local
// forces one.
export class Transcriber extends Context.Service<Transcriber, {
  // `prefer`: the provider to use when it's available (voiceovers keep to the one the approved takes used);
  // VIRAL_TRANSCRIBER still wins.
  transcribe(
    video: string,
    outDir: string,
    progress: Progress,
    options?: { readonly prefer?: TranscriptProvider }
  ): Effect.Effect<TranscribeResult, TranscribeError>
}>()("@viral/server/transcribe/transcriber") {
  static readonly layer = Layer.effect(
    Transcriber,
    Effect.gen(function*() {
      const scripts = yield* ScriptRunner
      const secrets = yield* Secrets
      const settings = yield* Settings
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

      const fail = (code: string) => (error: { readonly message: string }) => new TranscribeError({ code, message: error.message })

      // VIRAL_TRANSCRIBER is read once at startup and wins over the setting, which is read on every call.
      const forced = yield* Config.option(Config.String("VIRAL_TRANSCRIBER")).pipe(Effect.orDie)

      const pickProvider = Effect.fn("Transcriber.pickProvider")(function*(prefer: TranscriptProvider | undefined) {
        return yield* chooseProvider({
          environment: Option.getOrNull(forced),
          setting: Option.getOrElse(yield* settings.get(TRANSCRIBER_KEY, TranscriberChoice), () => "auto" as const),
          hasXaiKey: Option.isSome(yield* secrets.get("xai")),
          appleSilicon: isAppleSilicon,
          prefer
        })
      })

      const withWhisper = Effect.fn("Transcriber.whisper")(function*(video: string, outDir: string, progress: Progress) {
        const Line = Schema.fromJsonString(Schema.Union([
          Schema.Struct({ type: Schema.Literal("progress"), step: Schema.Literals(["audio", "transcribe"]) }),
          Schema.Struct({
            type: Schema.Literal("done"),
            segments: Schema.Int,
            duration_s: Schema.Finite,
            language: Schema.String
          })
        ]))
        return yield* scripts.run(
          [path.join(import.meta.dirname, "transcribe-whisper.py"), video, outDir],
          Schema.decodeEffect(Line),
          (line): Effect.Effect<TranscribeResult | undefined> =>
            line.type === "progress"
              ? progress(line.step === "audio" ? 5 : 15).pipe(Effect.as(undefined))
              : Effect.succeed({
                provider: "whisper-local",
                language: line.language,
                segments: line.segments,
                durationS: line.duration_s
              })
        ).pipe(Effect.mapError((error) => new TranscribeError({ code: error.code, message: error.message })))
      })

      const withGrok = Effect.fn("Transcriber.grok")(function*(video: string, outDir: string, progress: Progress) {
        const key = yield* secrets.get("xai")
        if (Option.isNone(key)) {
          return yield* new TranscribeError({ code: "no-provider", message: "no xAI API key for Grok transcription" })
        }
        const audio = path.join(outDir, "audio.mp3")

        // Mono 48 kbps mp3 keeps a 40-minute video around 15 MB, well under the API's 500 MB limit.
        yield* progress(5)
        const exit = yield* spawner.exitCode(ChildProcess.make("ffmpeg", [
          "-y", "-loglevel", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", audio
        ])).pipe(Effect.mapError(fail("audio")))
        if (exit !== ChildProcessSpawner.ExitCode(0)) {
          return yield* new TranscribeError({ code: "audio", message: `ffmpeg exited with code ${exit}` })
        }

        yield* progress(20)
        const bytes = yield* fs.readFile(audio).pipe(Effect.mapError(fail("audio")))
        const form = new FormData()
        form.append("model", GROK_MODEL)
        form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), "audio.mp3") // file must be the last field
        const response = yield* http.execute(
          HttpClientRequest.post(GROK_STT_URL).pipe(
            HttpClientRequest.bearerToken(Redacted.value(key.value)),
            HttpClientRequest.bodyFormData(form)
          )
        ).pipe(
          Effect.flatMap((res) => res.json),
          Effect.timeout(Duration.minutes(15)),
          Effect.mapError(fail("grok-http"))
        )
        const decoded = yield* Schema.decodeUnknownEffect(GrokSttResponse)(response).pipe(Effect.mapError(fail("grok-response")))
        const transcript = grokToTranscript(decoded, video)

        yield* Schema.encodeEffect(TranscriptJson)(transcript).pipe(
          Effect.flatMap((json) => fs.writeFileString(path.join(outDir, "transcript.json"), json)),
          Effect.andThen(fs.writeFileString(path.join(outDir, "transcript.txt"), transcriptText(transcript))),
          Effect.andThen(fs.remove(audio, { force: true })),
          Effect.mapError(fail("write"))
        )
        return {
          provider: "grok",
          language: transcript.language,
          segments: transcript.segments.length,
          durationS: decoded.duration
        } satisfies TranscribeResult
      })

      const transcribe = Effect.fn("Transcriber.transcribe")(function*(
        video: string,
        outDir: string,
        progress: Progress,
        options?: { readonly prefer?: TranscriptProvider }
      ) {
        const provider = yield* pickProvider(options?.prefer)
        yield* progress(0, `transcribing with ${provider}`)
        return yield* provider === "grok" ? withGrok(video, outDir, progress) : withWhisper(video, outDir, progress)
      })

      return Transcriber.of({ transcribe })
    })
  ).pipe(Layer.provide([ScriptRunner.layer, Secrets.layer, Settings.layer, NodeServices.layer, FetchHttpClient.layer]))

  // For tests: writes `answer(media)` as the transcript instead of transcribing.
  static readonly replay = (answer: (media: string) => Transcript) =>
    Layer.effect(
      Transcriber,
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        return Transcriber.of({
          transcribe: Effect.fn("Transcriber.replay")(function*(media: string, outDir: string) {
            const transcript = answer(media)
            const json = yield* Schema.encodeEffect(TranscriptJson)(transcript)
            yield* fs.writeFileString(path.join(outDir, "transcript.json"), json)
            return {
              provider: "whisper-local",
              language: transcript.language,
              segments: transcript.segments.length,
              durationS: transcript.segments.at(-1)?.end ?? 0
            } satisfies TranscribeResult
          }, Effect.orDie)
        })
      })
    ).pipe(Layer.provide(NodeServices.layer))
}
