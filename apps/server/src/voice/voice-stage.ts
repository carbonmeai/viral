import { NodeServices } from "@effect/platform-node"
import { type Artifact, closingLine, type GatePayload, type ProjectId, Script, Transcript, Voiceover } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Presets } from "../presets/presets.ts"
import { Projects } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { ElevenLabs } from "./eleven-labs.ts"
import { atempoFor, pace } from "./voice-pacing.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "voice", code, message })
const failWith = (code: string) => (error: { readonly message: string }) => fail(code, error.message)

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the voice stage runs on a project")
  return ctx.owner.id
}

const TranscriptJson = Schema.fromJsonString(Transcript)

// The script's narrated lines as one take; the real lines play in the creator's voice between them. Skipped lines are
// in it (voiced, then jumped over in the short), so they're billed too. The closing question comes last, with its ask
// ("Tell us in the comments, and subscribe for more."), and plays under the end card.
export const narrationText = (script: Script) =>
  script.beats.flatMap((beat) => beat._tag === "Narration" ? [beat.text.trim()] : beat._tag === "Cta" ? [closingLine(beat.question)] : []).join(" ")

// Speaks the approved script's narration with ElevenLabs in one take, trims the leading silence, speeds it to
// the preset's pace with atempo (and levels it to the style's loudness when it asks), and transcribes the result for word timings (local Whisper, like the approved
// candy voiceovers). Gated, since a new take costs credits.
export class VoiceStage extends Context.Service<VoiceStage, {
  readonly stage: StageDefinition
}>()("@viral/server/voice/voice-stage/VoiceStage") {
  static readonly layer = Layer.effect(
    VoiceStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const presets = yield* Presets
      const artifacts = yield* Artifacts
      const eleven = yield* ElevenLabs
      const transcriber = yield* Transcriber
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const ffmpeg = Effect.fn("VoiceStage.ffmpeg")(function*(args: ReadonlyArray<string>) {
        const exit = yield* spawner.exitCode(ChildProcess.make("ffmpeg", ["-y", "-loglevel", "error", ...args])).pipe(
          Effect.mapError(failWith("audio"))
        )
        if (exit !== ChildProcessSpawner.ExitCode(0)) return yield* fail("audio", `ffmpeg exited with code ${exit}`)
      })

      const duration = (file: string) =>
        spawner.string(ChildProcess.make("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])).pipe(
          Effect.map((out) => Number(out.trim())),
          Effect.mapError(failWith("audio"))
        )

      // Transcribes `media` into `outDir` and returns its words.
      const words = Effect.fn("VoiceStage.words")(function*(ctx: StageContext, media: string, outDir: string) {
        yield* fs.makeDirectory(outDir, { recursive: true }).pipe(Effect.mapError(failWith("write")))
        yield* transcriber.transcribe(media, outDir, () => Effect.void, { prefer: "whisper-local" }).pipe(
          Effect.mapError((e) => fail(`transcribe-${e.code}`, e.message))
        )
        const json = yield* fs.readFileString(path.join(outDir, "transcript.json")).pipe(Effect.mapError(failWith("transcribe")))
        const transcript = yield* Schema.decodeEffect(TranscriptJson)(json).pipe(Effect.mapError(failWith("transcribe")))
        return transcript.segments.flatMap((s) => s.words)
      })

      const run = Effect.fn("VoiceStage.run")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        if (project.format !== "narrated") return yield* fail("wrong-approach", "only narrated shorts have a voiceover")
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.mapError(() => fail("not-found", "the project's preset is gone")))
        const { model, wordsPerSecond } = preset.config.voice
        const voiceId = project.voiceId ?? preset.config.voice.voiceId

        const scriptArtifact = yield* artifacts.latest(ctx.owner, "script")
        const script = yield* Effect.fromOption(Option.flatMap(scriptArtifact, (a) => Schema.decodeUnknownOption(Script)(a.data))).pipe(
          Effect.mapError(() => fail("not-ready", "the short has no script yet"))
        )
        const text = narrationText(script)
        if (text === "") return yield* fail("not-ready", "the script has no narration")

        // 1. one take
        yield* ctx.progress(0, `speaking ${text.length} characters`)
        const speech = yield* eleven.speak({ voiceId, model, text }).pipe(Effect.mapError((e) => fail(e.code, e.message)))
        // what ElevenLabs billed (its character-cost header), which can be less than the text's length
        yield* ctx.recordCost({ model, ttsCharacters: speech.characters, provider: "elevenlabs", billing: "billed" })
        yield* ctx.progress(25, `ElevenLabs billed ${speech.characters} characters for ${text.length} characters of text`)
        const slot = yield* artifacts.allocate(ctx.owner, "voiceover")
        const raw = path.join(slot.dir, "vo_raw.mp3")
        const trimmed = path.join(slot.dir, "vo_trim.wav")
        const final = path.join(slot.dir, "vo.wav")
        yield* fs.writeFile(raw, speech.audio).pipe(Effect.mapError(failWith("write")))

        // 2. trim the leading silence, 3. measure the pace and speed it up to the preset's
        yield* ctx.progress(30, "measuring the pace")
        yield* ffmpeg(["-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-45dB", "-ar", "48000", trimmed])
        const rawPace = pace(yield* words(ctx, trimmed, path.join(slot.dir, "raw-transcript")))
        const atempo = atempoFor(rawPace, wordsPerSecond)
        // a style that levels the voice normalises the take (−10 LUFS: a raw take sits near −27 against clips near −9)
        const level = preset.config.voiceLevel === undefined ? "" : `,loudnorm=I=${preset.config.voiceLevel.lufs}:TP=-1.5:LRA=11`
        yield* ffmpeg(["-i", trimmed, "-af", `atempo=${atempo}${level}`, "-ar", "48000", final])

        // 4. word timings of the take as it will play
        yield* ctx.progress(60, `atempo ${atempo}; transcribing the take`)
        const transcriptSlot = yield* artifacts.allocate(ctx.owner, "voiceover-transcript")
        const finalPace = pace(yield* words(ctx, final, transcriptSlot.dir))
        const voiceover: Voiceover = {
          voiceId,
          model,
          text,
          characters: speech.characters,
          textCharacters: text.length,
          rawPace,
          atempo,
          pace: finalPace,
          durationS: yield* duration(final)
        }
        yield* fs.remove(trimmed, { force: true }).pipe(Effect.ignore)
        // the transcript first, so a recorded voiceover always has one
        yield* artifacts.record(transcriptSlot, {
          data: null,
          path: path.join(transcriptSlot.relDir, "transcript.json"),
          stageRunId: ctx.stageRunId
        })
        yield* artifacts.record(slot, { data: voiceover, path: path.join(slot.relDir, "vo.wav"), stageRunId: ctx.stageRunId })
      })

      const stage: StageDefinition = {
        name: "voice",
        artifact: "voiceover",
        gate: "Approve the voiceover?",
        run,
        gatePayload: (artifact: Artifact): GatePayload =>
          Option.match(Schema.decodeUnknownOption(Voiceover)(artifact.data), {
            onNone: () => ({ _tag: "ArtifactGate", artifact }),
            onSome: (voiceover) => ({ _tag: "VoiceGate", voiceover, file: artifacts.resolve(artifact) })
          })
      }
      return VoiceStage.of({ stage })
    })
  ).pipe(Layer.provide([Projects.layer, Presets.layer, Artifacts.layer, NodeServices.layer]))
}
