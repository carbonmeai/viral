import { NodeServices } from "@effect/platform-node"
import {
  MusicArrangementInvalid,
  type MusicArrangement,
  MusicBed,
  MusicPreviewFailed,
  type MusicTrackId,
  type MusicTrackNotFound,
  NarratedPlan,
  type Project,
  type ProjectId,
  type ProjectNotFound,
  type Run,
  Transcript
} from "@viral/contracts"
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { MusicLibrary } from "../music-library/music-library.ts"
import { Projects } from "../projects/projects.ts"
import { RunManager } from "../runs/run-manager.ts"
import { Settings } from "../settings/settings.ts"
import { checkArrangement, planArrangement, wordStartsInShort } from "./music-arrangement.ts"
import { MusicBedFitter } from "./music-bed-fitter.ts"
import { arrangementKey, dropWordKey } from "./music-bed-settings.ts"

const TranscriptJson = Schema.fromJsonString(Transcript)

// A short's fitted music bed: reading it, and changing the song, the drop word or the arrangement, which fits a
// new bed by re-running the short from assemble; or previewing an arrangement without changing anything. The
// library song is never changed.
export class MusicBeds extends Context.Service<MusicBeds, {
  // the bed and its file as the media route serves it, or null when the short has no music
  get(projectId: ProjectId): Effect.Effect<{ readonly bed: MusicBed; readonly media: string } | null, ProjectNotFound>
  // sets the song (null: no music; a different song resets the arrangement) and, when given, the drop word
  // (null: back to the start of the last narrated line), then re-runs the short from assemble so a new bed is
  // fitted
  refit(
    projectId: ProjectId,
    trackId: MusicTrackId | null,
    dropWord: number | null | undefined
  ): Effect.Effect<Run, ProjectNotFound | MusicTrackNotFound>
  // checks and sets the short's arrangement (null: back to automatic), then re-runs the short from assemble
  arrange(projectId: ProjectId, arrangement: MusicArrangement | null): Effect.Effect<Run, ProjectNotFound | MusicArrangementInvalid>
  // a bed for a proposed arrangement (null: the automatic one) in the short's music-preview folder, replacing
  // the last preview; nothing about the short changes
  preview(
    projectId: ProjectId,
    arrangement: MusicArrangement | null
  ): Effect.Effect<{ readonly bed: MusicBed; readonly media: string }, ProjectNotFound | MusicArrangementInvalid | MusicPreviewFailed>
}>()("@viral/server/music-bed/music-beds/MusicBeds") {
  static readonly layer = Layer.effect(
    MusicBeds,
    Effect.gen(function*() {
      const projects = yield* Projects
      const artifacts = yield* Artifacts
      const home = yield* ViralHome
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const settings = yield* Settings
      const library = yield* MusicLibrary
      const fitter = yield* MusicBedFitter
      const runs = yield* RunManager

      const invalid = (...problems: ReadonlyArray<string>) => Effect.fail(new MusicArrangementInvalid({ problems }))

      const latestBed = Effect.fn("MusicBeds.latestBed")(function*(projectId: ProjectId) {
        const latest = yield* artifacts.latest({ _tag: "Project", id: projectId }, "music-bed")
        return Option.flatMap(latest, (a) => Schema.decodeUnknownOption(MusicBed)(a.data))
      })

      const get = Effect.fn("MusicBeds.get")(function*(projectId: ProjectId) {
        const project = yield* projects.get(projectId)
        // a short whose music was removed keeps its old beds as history; it plays none
        if (project.musicTrackId === null) return null
        const latest = yield* artifacts.latest({ _tag: "Project", id: projectId }, "music-bed")
        if (Option.isNone(latest)) return null
        const bed = Schema.decodeUnknownOption(MusicBed)(latest.value.data)
        const file = artifacts.resolve(latest.value)
        if (Option.isNone(bed) || file === null) return null
        return { bed: bed.value, media: path.relative(home.root, file) }
      })

      const refit = Effect.fn("MusicBeds.refit")(function*(
        projectId: ProjectId,
        trackId: MusicTrackId | null,
        dropWord: number | null | undefined
      ) {
        // a different song also drops the arrangement (Projects.setMusic); a new drop word keeps it, and a block
        // starting on the drop word follows it
        yield* projects.setMusic(projectId, trackId)
        if (dropWord === null) yield* settings.remove(dropWordKey(projectId))
        else if (dropWord !== undefined) yield* settings.set(dropWordKey(projectId), dropWord)
        // assemble is where the bed is fitted; everything after it (render, metadata, thumbnail) follows
        return yield* runs.start({ _tag: "Project", id: projectId }, "assemble").pipe(Effect.orDie)
      })

      // What an arrangement for this short is checked against, from its song, its last assembled plan and its
      // voiceover.
      const context = Effect.fn("MusicBeds.context")(function*(project: Project) {
        if (project.musicTrackId === null) return yield* invalid("this short has no music to arrange; pick a song first")
        const track = yield* library.get(project.musicTrackId).pipe(Effect.option)
        if (Option.isNone(track)) return yield* invalid("this short's song is no longer in the library")
        const { bpm, dropS } = track.value
        if (bpm === null || dropS === null) return yield* invalid(`the BPM and drop of "${track.value.title}" aren't known yet`)
        const owner = { _tag: "Project", id: project.id } as const
        const plan = Option.flatMap(yield* artifacts.latest(owner, "narrated-plan"), (a) => Schema.decodeUnknownOption(NarratedPlan)(a.data))
        if (Option.isNone(plan)) return yield* invalid("this short hasn't been assembled yet; run it to its music first")
        const transcript = Option.flatMapNullishOr(yield* artifacts.latest(owner, "voiceover-transcript"), artifacts.resolve)
        if (Option.isNone(transcript)) return yield* invalid("this short has no voiceover yet")
        const words = yield* fs.readFileString(transcript.value).pipe(
          Effect.flatMap(Schema.decodeEffect(TranscriptJson)),
          Effect.map((t) => t.segments.flatMap((s) => s.words)),
          Effect.orElseSucceed(() => [])
        )
        const music = typeof plan.value.music === "object" ? plan.value.music : null
        const bed = yield* latestBed(project.id)
        return {
          track: track.value,
          plan: plan.value,
          music,
          words,
          dropWord: music?.drop_word ?? null,
          check: (arrangement: MusicArrangement) =>
            checkArrangement(arrangement, {
              barS: 240 / bpm,
              songDropS: dropS,
              songDurationS: track.value.durationS,
              dropWord: music?.drop_word ?? null,
              words: wordStartsInShort(plan.value, words),
              durationS: Option.match(bed, { onNone: () => null, onSome: (b) => b.durationS })
            })
        }
      })

      const arrange = Effect.fn("MusicBeds.arrange")(function*(projectId: ProjectId, arrangement: MusicArrangement | null) {
        const project = yield* projects.get(projectId)
        if (arrangement === null) {
          yield* settings.remove(arrangementKey(projectId))
        } else {
          const problems = (yield* context(project)).check(arrangement)
          if (problems.length > 0) return yield* invalid(...problems)
          yield* settings.set(arrangementKey(projectId), arrangement)
        }
        return yield* runs.start({ _tag: "Project", id: projectId }, "assemble").pipe(Effect.orDie)
      })

      const preview = Effect.fn("MusicBeds.preview")(function*(projectId: ProjectId, arrangement: MusicArrangement | null) {
        const project = yield* projects.get(projectId)
        const ctx = yield* context(project)
        if (ctx.music === null) return yield* invalid("this short's plan has no fitted music; run it from assemble first")
        if (arrangement !== null) {
          const problems = ctx.check(arrangement)
          if (problems.length > 0) return yield* invalid(...problems)
        }
        const { arrangement: _old, ...music } = ctx.music
        const { music_bed: _bed, ...plan } = ctx.plan
        // one preview at a time, in a fresh folder so a player never serves the last one from its cache
        const root = path.join(home.projectDir(projectId), "music-preview")
        yield* fs.remove(root, { recursive: true, force: true }).pipe(Effect.ignore)
        const dir = path.join(root, String(yield* Clock.currentTimeMillis))
        const made = yield* fitter.preview({
          plan: { ...plan, music: arrangement === null ? music : { ...music, arrangement: planArrangement(arrangement, ctx.dropWord) } },
          track: ctx.track,
          dropWord: ctx.dropWord,
          dropWordText: ctx.dropWord === null ? null : ctx.words[ctx.dropWord]?.w ?? null,
          arrangement
        }, dir).pipe(Effect.mapError((e) => e.code === "arrangement"
          ? new MusicArrangementInvalid({ problems: [e.message] })
          : new MusicPreviewFailed({ message: e.message })))
        return { bed: made.bed, media: path.relative(home.root, made.file) }
      })

      return MusicBeds.of({ get, refit, arrange, preview })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    Artifacts.layer,
    ViralHome.layer,
    Settings.layer,
    MusicLibrary.layer,
    MusicBedFitter.layer,
    NodeServices.layer
  ]))
}
