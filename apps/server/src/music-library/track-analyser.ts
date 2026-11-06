import { NodeServices } from "@effect/platform-node"
import { MusicAnalysisError } from "@viral/contracts"
import { Context, Effect, Layer, Path, Schema } from "effect"
import { ScriptRunner } from "../script-runner/script-runner.ts"

const isAnalysisError = Schema.is(MusicAnalysisError)

// What analyse-track.py measures. `dropS` is null when the track has no clear drop (music is optional, and
// so is a drop); `confidence` is how clear the bass rise was, 0-1.
export interface TrackAnalysis {
  readonly bpm: number | null
  readonly dropS: number | null
  readonly loudnessLufs: number | null
  readonly durationS: number
  readonly confidence: number
}

const Line = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), step: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("done"),
    bpm: Schema.NullOr(Schema.Finite),
    drop_s: Schema.NullOr(Schema.Finite),
    loudness_lufs: Schema.NullOr(Schema.Finite),
    duration_s: Schema.Finite,
    confidence: Schema.Finite
  })
]))

// Measures a track's tempo, drop and loudness with analyse-track.py (librosa), the method the viral-shorts
// skill used by hand: the drop is where the bass below 150 Hz jumps.
export class TrackAnalyser extends Context.Service<TrackAnalyser, {
  analyse(file: string): Effect.Effect<TrackAnalysis, MusicAnalysisError>
}>()("@viral/server/music-library/track-analyser/TrackAnalyser") {
  static readonly layer = Layer.effect(
    TrackAnalyser,
    Effect.gen(function*() {
      const scripts = yield* ScriptRunner
      const path = yield* Path.Path
      const analyse = Effect.fn("TrackAnalyser.analyse")(function*(file: string) {
        return yield* scripts.run(
          [path.join(import.meta.dirname, "analyse-track.py"), file],
          Schema.decodeEffect(Line),
          (line): Effect.Effect<TrackAnalysis | undefined> =>
            Effect.succeed(line.type === "done"
              ? {
                bpm: line.bpm,
                dropS: line.drop_s,
                loudnessLufs: line.loudness_lufs,
                durationS: line.duration_s,
                confidence: line.confidence
              }
              : undefined)
        ).pipe(Effect.mapError((error) => new MusicAnalysisError({ code: error.code, message: error.message })))
      })
      return TrackAnalyser.of({ analyse })
    })
  ).pipe(Layer.provide([ScriptRunner.layer, NodeServices.layer]))

  // For tests: answers with `answer(file)` instead of running the script.
  static readonly replay = (answer: (file: string) => TrackAnalysis | MusicAnalysisError) =>
    Layer.succeed(TrackAnalyser, TrackAnalyser.of({
      analyse: Effect.fn("TrackAnalyser.replay")(function*(file: string) {
        const result = answer(file)
        if (isAnalysisError(result)) return yield* result
        return result
      })
    }))
}
