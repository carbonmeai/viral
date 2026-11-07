import { NodeServices } from "@effect/platform-node"
import { AdRanges, type ArtifactKind, type ArtifactOwner, CutPlan, CutRenderPlan, MusicArrangement, NarratedPlan, type ProjectId, Script, ShotPlan, Transcript } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { MusicBedFitter } from "../music-bed/music-bed-fitter.ts"
import { checkArrangement, planArrangement, wordStartsInShort } from "../music-bed/music-arrangement.ts"
import { arrangementKey, dropWordKey } from "../music-bed/music-bed-settings.ts"
import { MusicLibrary } from "../music-library/music-library.ts"
import { Presets } from "../presets/presets.ts"
import { creditLine } from "../projects/credits.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { Projects, sourcesOf } from "../projects/projects.ts"
import { sourceLabel } from "../projects/source-context.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Settings } from "../settings/settings.ts"
import { narrationEnds } from "../shots/shot-rules.ts"
import { Sources } from "../sources/sources.ts"
import { assembleCut } from "./assemble-cut.ts"
import { assembleNarrated } from "./assemble-narrated.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "assemble", code, message })

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the assemble stage runs on a project")
  return ctx.owner.id
}

const TranscriptJson = Schema.fromJsonString(Transcript)
const PlanJson = Schema.fromJsonString(NarratedPlan)
const CutPlanJson = Schema.fromJsonString(CutRenderPlan)

// Turns the approved plan into the renderer's plan in the project's style (preset). No agent and no cost.
// `narrated`: the shot plan, with music, saved as narrated.json. `cut`: a cut-down short's sections, saved as
// cut.json. Both are the "assemble" stage; the pipeline picks one by the short's format.
export class AssembleStage extends Context.Service<AssembleStage, {
  readonly narrated: StageDefinition
  readonly cut: StageDefinition
}>()("@viral/server/assemble/assemble-stage/AssembleStage") {
  static readonly layer = Layer.effect(
    AssembleStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const projectSources = yield* ProjectSources
      const sources = yield* Sources
      const presets = yield* Presets
      const music = yield* MusicLibrary
      const artifacts = yield* Artifacts
      const home = yield* ViralHome
      const fitter = yield* MusicBedFitter
      const settings = yield* Settings
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      // The latest artifact of a kind: its absolute file, or its data decoded.
      const fileOf = (owner: ArtifactOwner, kind: ArtifactKind) =>
        Effect.flatMap(artifacts.latest(owner, kind), (a) =>
          Effect.fromOption(Option.flatMapNullishOr(a, artifacts.resolve)).pipe(
            Effect.mapError(() => fail("not-ready", `no ${kind} yet`))
          ))
      const dataOf = <A, I>(owner: ArtifactOwner, kind: ArtifactKind, schema: Schema.Codec<A, I>) =>
        Effect.flatMap(artifacts.latest(owner, kind), (a) =>
          Effect.fromOption(Option.flatMap(a, (x) => Schema.decodeUnknownOption(schema)(x.data))).pipe(
            Effect.mapError(() => fail("not-ready", `no ${kind} yet`))
          ))

      // The cut-down renderer plays one video until multi-video cut-downs land; a section from another stops the run
      // here rather than playing the wrong footage.
      const oneVideo = (clips: ReadonlyArray<{ readonly source?: number }>) => {
        const other = clips.find((c) => (c.source ?? 0) !== 0)
        return other === undefined
          ? Effect.void
          : Effect.fail(fail("multi-video", `a section comes from ${sourceLabel(other.source!)}; cut-down shorts render from one video for now`))
      }

      const runNarrated = Effect.fn("AssembleStage.narrated")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        // every video the short draws from, V1 first: its file, transcript and excluded ranges
        const videos = yield* projectSources.of(project).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const sourceOwner = videos[0].owner
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.mapError(() => fail("not-found", "the project's preset is gone")))

        const script = yield* dataOf(ctx.owner, "script", Script)
        const shots = yield* dataOf(ctx.owner, "shot-plan", ShotPlan)
        // a clip pointing at a video the short no longer has would play the wrong footage
        const lost = [...shots.shots, ...shots.inserts, ...shots.outro].find((c) => (c.source ?? 0) >= videos.length)
        if (lost !== undefined) {
          return yield* fail("missing-video", `a clip comes from ${sourceLabel(lost.source!)}, which isn't one of this short's videos`)
        }
        const voiceoverTranscript = yield* fileOf(ctx.owner, "voiceover-transcript")
        const words = yield* fs.readFileString(voiceoverTranscript).pipe(
          Effect.flatMap(Schema.decodeEffect(TranscriptJson)),
          Effect.map((t) => t.segments.flatMap((s) => s.words)),
          Effect.mapError((e) => fail("not-ready", e.message))
        )
        const others = yield* Effect.forEach(videos.slice(1), (v) =>
          Effect.all({
            source: fileOf(v.owner, "source-video"),
            sourceTranscript: fileOf(v.owner, "transcript"),
            excluded: Effect.succeed(v.excluded)
          }))
        const track = project.musicTrackId === null
          ? null
          : yield* music.get(project.musicTrackId).pipe(Effect.option, Effect.map(Option.getOrNull))
        // the drop lands on the word you picked for this short, or else on the first word of the last narrated line
        const ends = narrationEnds(script, words)
        const picked = Option.filter(yield* settings.get(dropWordKey(project.id), Schema.Int), (w) => w >= 0 && w < words.length)
        const dropWord = Option.isSome(picked) ? picked.value : ends.length === 0 ? null : ends.length === 1 ? 0 : ends.at(-2)! + 1

        const assembled = assembleNarrated({
          slug: project.slug,
          title: project.title,
          source: yield* fileOf(sourceOwner, "source-video"),
          sourceTranscript: yield* fileOf(sourceOwner, "transcript"),
          voiceover: yield* fileOf(ctx.owner, "voiceover"),
          voiceoverTranscript,
          voiceoverWords: words,
          preset: preset.config,
          script,
          shots,
          excluded: videos[0].excluded,
          others,
          credit: creditLine(videos.map((v) => v.source)),
          music: track === null ? null : { track, file: path.join(home.music, track.path) },
          dropWord
        })
        if (track !== null && assembled.music === undefined) {
          yield* ctx.progress(null, `"${track.title}" has no BPM or drop yet, so this short goes without music`)
        }
        // your arrangement of the song, when you made one and it still fits the short (a new voiceover can leave
        // a pinned word behind); otherwise the automatic one
        const stored = Option.getOrNull(yield* settings.get(arrangementKey(project.id), MusicArrangement))
        const arrangement = stored === null || track === null || typeof assembled.music !== "object" || track.bpm === null || track.dropS === null
          ? null
          : yield* Effect.gen(function*() {
            const problems = checkArrangement(stored, {
              barS: 240 / track.bpm!,
              songDropS: track.dropS!,
              songDurationS: track.durationS,
              dropWord,
              words: wordStartsInShort(assembled, words),
              durationS: null
            })
            if (problems.length === 0) return stored
            yield* ctx.progress(null, `your music arrangement no longer fits this short (${problems[0]}), so the automatic one is used`)
            return null
          })
        const withArrangement: NarratedPlan = arrangement === null || typeof assembled.music !== "object"
          ? assembled
          : { ...assembled, music: { ...assembled.music, arrangement: planArrangement(arrangement, dropWord) } }
        // the short gets its own fitted bed, saved with it; the library song is never changed
        // only a song with a known drop is fitted; a plain looped track (a file name) plays as it is
        const plan = track === null || typeof withArrangement.music !== "object"
          ? withArrangement
          : (yield* fitter.fit({
            owner: ctx.owner,
            stageRunId: ctx.stageRunId,
            plan: withArrangement,
            track,
            dropWord,
            dropWordText: dropWord === null ? null : words[dropWord]?.w ?? null,
            arrangement
          }).pipe(
            Effect.tap(({ bed }) => ctx.progress(null, `music: "${bed.trackTitle}" fitted, the drop lands at ${bed.dropAtS.toFixed(1)}s`)),
            Effect.mapError((e) => fail(`music-${e.code}`, e.message))
          )).plan

        const slot = yield* artifacts.allocate(ctx.owner, "narrated-plan")
        yield* Schema.encodeEffect(PlanJson)(plan).pipe(
          Effect.flatMap((json) => fs.writeFileString(path.join(slot.dir, "narrated.json"), json)),
          Effect.mapError((e) => fail("write", e.message))
        )
        yield* artifacts.record(slot, { data: plan, path: path.join(slot.relDir, "narrated.json"), stageRunId: ctx.stageRunId })
      })

      // A cut-down short has no voiceover or music: the sections and the style make the whole plan.
      const runCut = Effect.fn("AssembleStage.cut")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const sourceOwner = { _tag: "Source", id: sourcesOf(project)[0] } as const
        const source = yield* sources.get(sourceOwner.id).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.mapError(() => fail("not-found", "the project's preset is gone")))
        const cutPlan = yield* dataOf(ctx.owner, "cut-plan", CutPlan)
        yield* oneVideo(cutPlan.sections)
        const excluded = Option.match(
          Option.flatMap(yield* artifacts.latest(sourceOwner, "ad-ranges"), (a) => Schema.decodeUnknownOption(AdRanges)(a.data)),
          { onNone: () => [], onSome: (a) => a.ranges }
        )
        const plan = assembleCut({
          slug: project.slug,
          title: project.title,
          source: yield* fileOf(sourceOwner, "source-video"),
          sourceTranscript: yield* fileOf(sourceOwner, "transcript"),
          preset: preset.config,
          plan: cutPlan,
          excluded,
          credit: creditLine([source])
        })
        if (project.musicTrackId !== null) yield* ctx.progress(null, "cut-down shorts keep the creator's own audio, so the music track isn't used")
        const slot = yield* artifacts.allocate(ctx.owner, "cut-render-plan")
        yield* Schema.encodeEffect(CutPlanJson)(plan).pipe(
          Effect.flatMap((json) => fs.writeFileString(path.join(slot.dir, "cut.json"), json)),
          Effect.mapError((e) => fail("write", e.message))
        )
        yield* artifacts.record(slot, { data: plan, path: path.join(slot.relDir, "cut.json"), stageRunId: ctx.stageRunId })
      })

      return AssembleStage.of({
        narrated: { name: "assemble", artifact: "narrated-plan", gate: null, run: runNarrated },
        cut: { name: "assemble", artifact: "cut-render-plan", gate: null, run: runCut }
      })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    ProjectSources.layer,
    Sources.layer,
    Presets.layer,
    MusicLibrary.layer,
    MusicBedFitter.layer,
    Settings.layer,
    Artifacts.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
