import { NodeServices } from "@effect/platform-node"
import { type ArtifactOwner, type MusicBed, MusicBedSegment, type MusicTrack, NarratedPlan, type StageRunId } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ScriptRunner } from "../script-runner/script-runner.ts"

// `code` is the script's ("no-music", "no-drop", "audio"), or "spawn" / "exit" from the runner, or "write".
export class MusicBedError extends Schema.TaggedError<MusicBedError>()("MusicBedError", {
  code: Schema.String,
  message: Schema.String
}) {}

const FitLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), step: Schema.Literal("fit") }),
  Schema.Struct({
    type: Schema.Literal("done"),
    file: Schema.String,
    duration_s: Schema.Finite,
    drop_at_s: Schema.Finite,
    song_drop_s: Schema.Finite,
    bar_s: Schema.Finite,
    segments: Schema.Array(MusicBedSegment)
  })
]))
const PlanJson = Schema.fromJsonString(NarratedPlan)

export interface FitInput {
  readonly owner: ArtifactOwner
  // the assemble stage run that made it
  readonly stageRunId: StageRunId
  // the assembled plan, whose `music` names the song, its beat and the drop word
  readonly plan: NarratedPlan
  readonly track: MusicTrack
  readonly dropWord: number | null
  readonly dropWordText: string | null
}

export interface Fitted {
  // the plan, now pointing the renderer at the fitted bed
  readonly plan: NarratedPlan
  readonly bed: MusicBed
}

// Fits a short's own music bed from a library song (fit-music.py) and records it as the short's `music-bed`
// artifact: the wav, and which parts of the song play where. The library song is only read.
export class MusicBedFitter extends Context.Service<MusicBedFitter, {
  fit(input: FitInput): Effect.Effect<Fitted, MusicBedError>
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

      const fit = Effect.fn("MusicBedFitter.fit")(function*(input: FitInput) {
        const slot = yield* artifacts.allocate(input.owner, "music-bed")
        // the plan the bed is fitted for, kept next to it so the fit can be traced
        const planFile = path.join(slot.dir, "plan.json")
        yield* Schema.encodeEffect(PlanJson)(input.plan).pipe(
          Effect.flatMap((json) => fs.writeFileString(planFile, json)),
          Effect.mapError(write)
        )
        const wav = path.join(slot.dir, "bed.wav")
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
          segments: done.segments
        }
        yield* artifacts.record(slot, { data: bed, path: path.join(slot.relDir, "bed.wav"), stageRunId: input.stageRunId })
        return { plan: { ...input.plan, music_bed: { file: wav, drop_at: done.drop_at_s } }, bed }
      })

      return MusicBedFitter.of({ fit })
    })
  ).pipe(Layer.provide([Artifacts.layer, ScriptRunner.layer, NodeServices.layer]))
}
