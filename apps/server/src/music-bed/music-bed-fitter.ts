import { NodeServices } from "@effect/platform-node"
import {
  type ArtifactOwner,
  type MusicArrangement,
  type MusicBed,
  type MusicBedArrangement,
  MusicBedSegment,
  type MusicTrack,
  NarratedPlan,
  type StageRunId
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ScriptRunner } from "../script-runner/script-runner.ts"

// `code` is the script's ("no-music", "no-drop", "arrangement", "audio"), or "spawn" / "exit" from the runner,
// or "write".
export class MusicBedError extends Schema.TaggedError<MusicBedError>()("MusicBedError", {
  code: Schema.String,
  message: Schema.String
}) {}

// The arrangement as the script played it (music_bed.py's snake_case).
const PlayedArrangement = Schema.Struct({
  automatic: Schema.Boolean,
  drop_bar: Schema.Int,
  song_bars: Schema.Int,
  blocks: Schema.Array(Schema.Struct({
    from_bar: Schema.Int,
    to_bar: Schema.Int,
    loops: Schema.Int,
    word: Schema.NullOr(Schema.Int),
    from: Schema.Finite,
    to: Schema.Finite,
    at: Schema.NullOr(Schema.Finite),
    end: Schema.NullOr(Schema.Finite)
  }))
})
type PlayedArrangement = typeof PlayedArrangement.Type

const Done = Schema.Struct({
  type: Schema.Literal("done"),
  file: Schema.String,
  duration_s: Schema.Finite,
  drop_at_s: Schema.Finite,
  song_drop_s: Schema.Finite,
  bar_s: Schema.Finite,
  segments: Schema.Array(MusicBedSegment),
  arrangement: PlayedArrangement
})
const FitLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), step: Schema.Literal("fit") }),
  Done
]))
const PlanJson = Schema.fromJsonString(NarratedPlan)

export interface FitInput {
  readonly owner: ArtifactOwner
  // the assemble stage run that made it
  readonly stageRunId: StageRunId
  // the assembled plan, whose `music` names the song, its beat, the drop word and any arrangement
  readonly plan: NarratedPlan
  readonly track: MusicTrack
  readonly dropWord: number | null
  readonly dropWordText: string | null
  // the arrangement the plan's `music.arrangement` was made from, or null for the automatic one
  readonly arrangement: MusicArrangement | null
}

export interface Fitted {
  // the plan, now pointing the renderer at the fitted bed
  readonly plan: NarratedPlan
  readonly bed: MusicBed
}

// The played arrangement in the app's terms: each block's start is the one you gave it, or, for the automatic
// arrangement, the drop word for the pinned block and "after" for the rest.
const arrangementOf = (played: PlayedArrangement, given: MusicArrangement | null): MusicBedArrangement => ({
  automatic: played.automatic,
  dropBar: played.drop_bar,
  songBars: played.song_bars,
  blocks: played.blocks.map((b, i) => ({
    fromBar: b.from_bar,
    toBar: b.to_bar,
    loops: b.loops,
    start: given?.blocks[i]?.start ?? (b.word === null ? "after" : "drop"),
    fromS: b.from,
    toS: b.to,
    atS: b.at,
    endS: b.end
  }))
})

// Fits a short's own music bed from a library song (fit-music.py) and records it as the short's `music-bed`
// artifact: the wav, and which parts of the song play where. The library song is only read. `preview` makes a
// bed in a folder of your choosing and records nothing.
export class MusicBedFitter extends Context.Service<MusicBedFitter, {
  fit(input: FitInput): Effect.Effect<Fitted, MusicBedError>
  preview(input: Omit<FitInput, "owner" | "stageRunId">, dir: string): Effect.Effect<{ readonly bed: MusicBed; readonly file: string }, MusicBedError>
}>()("@viral/server/music-bed/music-bed-fitter/MusicBedFitter") {
  static readonly layer = Layer.effect(
    MusicBedFitter,
    Effect.gen(function*() {
      const artifacts = yield* Artifacts
      const scripts = yield* ScriptRunner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const script = path.join(import.meta.dirname, "..", "render", "fit-music.py")
      const write = (e: { readonly message: string }) => new MusicBedError({ code: "write", message: e.message })

      // writes the plan into `dir` (so the fit can be traced) and fits `dir`/bed.wav for it
      const run = Effect.fn("MusicBedFitter.run")(function*(input: Omit<FitInput, "owner" | "stageRunId">, dir: string) {
        const planFile = path.join(dir, "plan.json")
        yield* Schema.encodeEffect(PlanJson)(input.plan).pipe(
          Effect.flatMap((json) => fs.writeFileString(planFile, json)),
          Effect.mapError(write)
        )
        const wav = path.join(dir, "bed.wav")
        const done = yield* scripts.run(
          [script, planFile, wav],
          Schema.decodeEffect(FitLine),
          (line) => Effect.succeed(line.type === "done" ? line : undefined)
        ).pipe(Effect.mapError((e) => new MusicBedError({ code: e.code, message: e.message })))
        const bed: MusicBed = {
          trackId: input.track.id,
          trackTitle: input.track.title,
          durationS: done.duration_s,
          dropAtS: done.drop_at_s,
          dropWord: input.dropWord,
          dropWordText: input.dropWordText,
          songDropS: done.song_drop_s,
          barS: done.bar_s,
          segments: done.segments,
          arrangement: arrangementOf(done.arrangement, input.arrangement)
        }
        return { bed, file: wav, dropAt: done.drop_at_s }
      })

      const fit = Effect.fn("MusicBedFitter.fit")(function*(input: FitInput) {
        const slot = yield* artifacts.allocate(input.owner, "music-bed")
        const { bed, file, dropAt } = yield* run(input, slot.dir)
        yield* artifacts.record(slot, { data: bed, path: path.join(slot.relDir, "bed.wav"), stageRunId: input.stageRunId })
        return { plan: { ...input.plan, music_bed: { file, drop_at: dropAt } }, bed }
      })

      const preview = Effect.fn("MusicBedFitter.preview")(function*(input: Omit<FitInput, "owner" | "stageRunId">, dir: string) {
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(write))
        const { bed, file } = yield* run(input, dir)
        return { bed, file }
      })

      return MusicBedFitter.of({ fit, preview })
    })
  ).pipe(Layer.provide([Artifacts.layer, ScriptRunner.layer, NodeServices.layer]))
}
