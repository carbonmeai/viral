import { NodeServices } from "@effect/platform-node"
import { type ArtifactKind, type ArtifactOwner, closingOf, CutPlan, CutRenderPlan, MusicArrangement, NarratedPlan, type ProjectId, RankingPlan, RankingRenderPlan, Script, ShotPlan, Transcript } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { MusicBedFitter } from "../music-bed/music-bed-fitter.ts"
import { checkArrangement, planArrangement, wordStartsInShort } from "../music-bed/music-arrangement.ts"
import { arrangementKey, dropWordKey } from "../music-bed/music-bed-settings.ts"
import { MusicLibrary } from "../music-library/music-library.ts"
import { Presets } from "../presets/presets.ts"
import { appearanceOrder, creditedChannels, creditLine } from "../projects/credits.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { Projects } from "../projects/projects.ts"
import { sourceLabel } from "../projects/source-context.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Settings } from "../settings/settings.ts"
import { closingWord, entriesOnTake, narrationEndOf, narrationEnds } from "../shots/shot-rules.ts"
import { assembleCut } from "./assemble-cut.ts"
import { assembleRanking } from "./assemble-ranking.ts"
import { assembleNarrated } from "./assemble-narrated.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "assemble", code, message })

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the assemble stage runs on a project")
  return ctx.owner.id
}

const TranscriptJson = Schema.fromJsonString(Transcript)
const PlanJson = Schema.fromJsonString(NarratedPlan)
const CutPlanJson = Schema.fromJsonString(CutRenderPlan)
const RankingPlanJson = Schema.fromJsonString(RankingRenderPlan)

// Turns the approved plan into the renderer's plan in the project's style (preset). No agent and no cost.
// `narrated`: the shot plan, with music, saved as narrated.json. `cut`: a cut-down short's sections, saved as
// cut.json. Both are the "assemble" stage; the pipeline picks one by the short's format.
export class AssembleStage extends Context.Service<AssembleStage, {
  readonly narrated: StageDefinition
  readonly cut: StageDefinition
  readonly ranking: StageDefinition
}>()("@viral/server/assemble/assemble-stage/AssembleStage") {
  static readonly layer = Layer.effect(
    AssembleStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const projectSources = yield* ProjectSources
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

      // A clip pointing at a video the short no longer has would play the wrong footage.
      const lostVideo = (clips: ReadonlyArray<{ readonly source?: number }>, count: number, what: string) => {
        const lost = clips.find((c) => (c.source ?? 0) >= count)
        return lost === undefined
          ? Effect.void
          : Effect.fail(fail("missing-video", `${what} comes from ${sourceLabel(lost.source!)}, which isn't one of this short's videos`))
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
        yield* lostVideo([...shots.shots, ...shots.inserts, ...shots.outro], videos.length, "a clip")
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

        // the take's closing line (voiced after the story): cut out of the narration, and played under the end card when
        // the style ends with a comment question
        const closingAt = closingWord(script, words)
        const closingQuestion = closingOf(script)
        const closing = closingAt === null || closingQuestion === null ? null : {
          narrationEnd: narrationEndOf(script, words, words.at(-1)!.e),
          voEnd: Math.round((words.at(-1)!.e + 0.3) * 1000) / 1000,
          question: preset.config.commentQuestion === true ? closingQuestion : null
        }
        if (closingAt === null && closingQuestion !== null && preset.config.commentQuestion === true) {
          yield* ctx.progress(null, "the voiceover doesn't say the closing question, so this short has no end card")
        }

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
          // every channel whose footage plays, in the order it first appears
          credit: creditLine(videos.map((v) => v.source), appearanceOrder({ _tag: "Narrated", plan: shots })),
          music: track === null ? null : { track, file: path.join(home.music, track.path) },
          dropWord,
          closing,
          // a narrated ranking: a "#N" card where the narrator says each entry's "Number"
          ...(project.approach === "narrated-ranking" ? { rankCards: entriesOnTake(script, words, project.sourceIds.length) } : {})
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
        // every video the short draws from, V1 first: its file, transcript and excluded ranges
        const videos = yield* projectSources.of(project).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const sourceOwner = videos[0].owner
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.mapError(() => fail("not-found", "the project's preset is gone")))
        const cutPlan = yield* dataOf(ctx.owner, "cut-plan", CutPlan)
        yield* lostVideo(cutPlan.sections, videos.length, "a section")
        const others = yield* Effect.forEach(videos.slice(1), (v) =>
          Effect.all({
            source: fileOf(v.owner, "source-video"),
            sourceTranscript: fileOf(v.owner, "transcript"),
            excluded: Effect.succeed(v.excluded)
          }))
        const plan = assembleCut({
          slug: project.slug,
          title: project.title,
          source: yield* fileOf(sourceOwner, "source-video"),
          sourceTranscript: yield* fileOf(sourceOwner, "transcript"),
          preset: preset.config,
          plan: cutPlan,
          excluded: videos[0].excluded,
          others,
          credit: creditLine(videos.map((v) => v.source), appearanceOrder({ _tag: "Cut", plan: cutPlan }))
        })
        if (project.musicTrackId !== null) yield* ctx.progress(null, "cut-down shorts keep the creator's own audio, so the music track isn't used")
        const slot = yield* artifacts.allocate(ctx.owner, "cut-render-plan")
        yield* Schema.encodeEffect(CutPlanJson)(plan).pipe(
          Effect.flatMap((json) => fs.writeFileString(path.join(slot.dir, "cut.json"), json)),
          Effect.mapError((e) => fail("write", e.message))
        )
        yield* artifacts.record(slot, { data: plan, path: path.join(slot.relDir, "cut.json"), stageRunId: ctx.stageRunId })
      })

      // A ranking has no voiceover, music or captions: the moments and the style make the whole plan.
      const runRanking = Effect.fn("AssembleStage.ranking")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const videos = yield* projectSources.of(project).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.mapError(() => fail("not-found", "the project's preset is gone")))
        const moments = yield* dataOf(ctx.owner, "ranking-plan", RankingPlan)
        yield* lostVideo(moments.entries, videos.length, "an entry")
        const files = yield* Effect.forEach(videos, (v) =>
          Effect.all({
            path: fileOf(v.owner, "source-video"),
            transcript: fileOf(v.owner, "transcript"),
            excluded: Effect.succeed(v.excluded),
            // each entry's channel, unless the footage is yours
            channel: Effect.succeed(creditedChannels([v.source])[0] ?? null)
          }))
        const plan = assembleRanking({ slug: project.slug, plan: moments, preset: preset.config, videos: files })
        if (project.musicTrackId !== null) yield* ctx.progress(null, "rankings keep each clip's own sound, so the music track isn't used")
        const slot = yield* artifacts.allocate(ctx.owner, "ranking-render-plan")
        yield* Schema.encodeEffect(RankingPlanJson)(plan).pipe(
          Effect.flatMap((json) => fs.writeFileString(path.join(slot.dir, "ranking.json"), json)),
          Effect.mapError((e) => fail("write", e.message))
        )
        yield* artifacts.record(slot, { data: plan, path: path.join(slot.relDir, "ranking.json"), stageRunId: ctx.stageRunId })
      })

      return AssembleStage.of({
        narrated: { name: "assemble", artifact: "narrated-plan", gate: null, run: runNarrated },
        cut: { name: "assemble", artifact: "cut-render-plan", gate: null, run: runCut },
        ranking: { name: "assemble", artifact: "ranking-render-plan", gate: null, run: runRanking }
      })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    ProjectSources.layer,
    Presets.layer,
    MusicLibrary.layer,
    MusicBedFitter.layer,
    Settings.layer,
    Artifacts.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
