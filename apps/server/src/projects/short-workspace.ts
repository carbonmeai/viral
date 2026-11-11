import { NodeServices } from "@effect/platform-node"
import {
  type ArtifactKind,
  CutPlan,
  type Project,
  type ProjectId,
  type ProjectNotFound,
  RANKING_LIMITS,
  RankingPlan,
  type RankingProposal,
  PublishedShort,
  RenderedShort,
  Script,
  type SectionsProposal,
  ShotPlan,
  type ShotProposal,
  type ShortWorkspace,
  type ThumbConfig,
  Thumbnail,
  Transcript,
  Voiceover
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { checkConfig } from "../thumbnail/thumbnail-rules.ts"
import { checkRanking as checkRankingRules, framingKey, type RankingDraft, rankingMaxSeconds } from "../moments/moment-rules.ts"
import { RankingFrames } from "../moments/ranking-frames.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { ThumbnailRenderer } from "../thumbnail/thumbnail-renderer.ts"
import { Presets } from "../presets/presets.ts"
import { RunStore } from "../runs/run-store.ts"
import { checkScript as checkScriptRules, scriptLimitsFor } from "../script/script-rules.ts"
import { checkSections as checkSectionsRules, SECTION_LIMITS } from "../sections/section-rules.ts"
import { checkShots as checkShotsRules, entriesOnTake, placeReals, storyTake } from "../shots/shot-rules.ts"
import { type ProjectSource, ProjectSources } from "./project-sources.ts"
import { Projects } from "./projects.ts"

const TranscriptJson = Schema.fromJsonString(Transcript)

// A checked ranking as the editor edits it again: the snapped shots without their words.
const proposalOf = (draft: RankingDraft): RankingProposal => ({
  title: draft.title,
  order: draft.order,
  entries: draft.entries.map((e) => ({ ...e, shots: e.shots.map(({ text: _text, ...shot }) => shot) }))
})

// A short's editor in one call: the short, its video, style and voice, its latest run with the gate it's waiting
// on, and the latest version of everything the run has made (an artifact that no longer decodes is left out, so
// an old version never breaks the editor).
export class ShortWorkspaces extends Context.Service<ShortWorkspaces, {
  get(projectId: ProjectId): Effect.Effect<ShortWorkspace, ProjectNotFound>
  // the script stage's own rules, for an edit before it's sent
  checkScript(projectId: ProjectId, script: Script): Effect.Effect<ReadonlyArray<string>, ProjectNotFound>
  // the shots stage's own rules, for an edited shot list before it's sent
  checkShots(projectId: ProjectId, proposal: ShotProposal): Effect.Effect<ReadonlyArray<string>, ProjectNotFound>
  // the sections stage's own rules, for a cut-down short's edited sections before they're sent
  checkSections(projectId: ProjectId, proposal: SectionsProposal): Effect.Effect<ReadonlyArray<string>, ProjectNotFound>
  // the thumbnail stage's own rules, for an edited thumbnail config before it's sent
  checkThumbnail(projectId: ProjectId, config: ThumbConfig): Effect.Effect<ReadonlyArray<string>, ProjectNotFound>
  // the moments stage's own rules, for a ranking's edited moments before they're sent; the ranking comes back snapped
  // to whole sentences, with its length
  checkRanking(projectId: ProjectId, proposal: RankingProposal): Effect.Effect<{
    readonly problems: ReadonlyArray<string>
    readonly proposal: RankingProposal
    readonly durationS: number
  }, ProjectNotFound>
}>()("@viral/server/projects/short-workspace/ShortWorkspaces") {
  static readonly layer = Layer.effect(
    ShortWorkspaces,
    Effect.gen(function*() {
      const projects = yield* Projects
      const projectSources = yield* ProjectSources
      const presets = yield* Presets
      const artifacts = yield* Artifacts
      const store = yield* RunStore
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const home = yield* ViralHome
      const thumbnails = yield* ThumbnailRenderer
      const rankingFrames = yield* RankingFrames
      const sets = yield* VideoSets

      // A file as the media route serves it: its path relative to the Viral home. Stages record absolute paths,
      // which go stale when the library moves, but always write the file into a known folder (the artifact's own,
      // or the renders folder), so it's found there by name; null when it isn't there.
      const fileIn = Effect.fn("ShortWorkspaces.fileIn")(function*(folder: string, file: string | null) {
        if (file === null) return null
        const relative = path.join(folder, path.basename(file))
        const exists = yield* fs.exists(path.join(home.root, relative)).pipe(Effect.orElseSucceed(() => false))
        return exists ? relative : null
      })
      const rendersFolder = path.relative(home.root, home.renders)

      // the voiceover's words as spoken, or none before there's a voiceover
      const voiceoverWords = Effect.fn("ShortWorkspaces.voiceoverWords")(function*(owner: { readonly _tag: "Project"; readonly id: ProjectId }) {
        const voTranscript = yield* artifacts.latest(owner, "voiceover-transcript")
        return yield* Option.match(Option.flatMapNullishOr(voTranscript, artifacts.resolve), {
          onNone: () => Effect.succeed([]),
          onSome: (file) =>
            fs.readFileString(file).pipe(
              Effect.flatMap(Schema.decodeEffect(TranscriptJson)),
              Effect.map((t) => t.segments.flatMap((s) => s.words)),
              Effect.orElseSucceed(() => [])
            )
        })
      })

      // The short's videos, V1 first, as the stages check against them.
      const sourcesFor = (project: Project) => projectSources.of(project).pipe(Effect.orDie)

      // What a cut-down short is cut from: each video's words, length and ads, as the sections stage checks them.
      // None while a video has no transcript yet.
      const sectionSources = (sources: ReadonlyArray<ProjectSource>) =>
        sources.some((s) => Option.isNone(s.transcript)) ? Option.none<ReadonlyArray<ProjectSource>>() : Option.some(sources)

      // What a ranking is checked against: each video's words, length, excluded ranges and detected framing, and the
      // longest it may be (the research's length). None while a video isn't downloaded or transcribed.
      const rankingContext = Effect.fn("ShortWorkspaces.rankingContext")(function*(project: Project, sources: ReadonlyArray<ProjectSource>) {
        if (sources.some((s) => Option.isNone(s.transcript) || Option.isNone(s.video))) return Option.none()
        const set = project.setId === null ? Option.none() : yield* sets.get(project.setId).pipe(Effect.option)
        const length = Option.getOrNull(Option.map(Option.flatMapNullishOr(set, (s) => s.research), (r) => r.length))
        const videos = yield* Effect.forEach(sources, (s) =>
          Effect.map(rankingFrames.ofVideo(s.source.id, Option.getOrThrow(s.video)), (framing) => ({
            words: s.words,
            seconds: s.seconds,
            excluded: s.excluded,
            framing,
            path: Option.getOrThrow(s.video)
          })))
        return Option.some({ videos, maxSeconds: rankingMaxSeconds(length) })
      })

      const get = Effect.fn("ShortWorkspaces.get")(function*(projectId: ProjectId) {
        const project = yield* projects.get(projectId)
        const owner = { _tag: "Project", id: projectId } as const
        const sources = yield* sourcesFor(project)
        const [v1] = sources
        const source = v1.source
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.catch(() => presets.getDefault))
        const limits = scriptLimitsFor(project.approach, project.sourceIds.length)

        const runs = yield* store.listRuns(owner)
        const run = [...runs].sort((a, b) => b.startedAt.epochMilliseconds - a.startedAt.epochMilliseconds)[0] ?? null
        const stages = run === null ? [] : yield* store.listStageRuns(run.id)
        const pending = run === null ? null : (yield* store.listPendingRequests).find((r) => r.runId === run.id) ?? null

        // the latest version of a kind, decoded; none when it's missing or no longer decodes
        const latest = <A, I>(kind: ArtifactKind, schema: Schema.Codec<A, I>) =>
          Effect.map(artifacts.latest(owner, kind), (artifact) =>
            Option.flatMap(artifact, (a) =>
              Option.map(Schema.decodeUnknownOption(schema)(a.data), (data) => ({ version: a.version, path: a.path, data }))))

        const script = yield* latest("script", Script)
        const voiceover = yield* latest("voiceover", Voiceover)
        const words = yield* voiceoverWords(owner)
        const shotPlan = yield* latest("shot-plan", ShotPlan)
        const cutPlan = yield* latest("cut-plan", CutPlan)
        const rankingPlan = yield* latest("ranking-plan", RankingPlan)
        const render = yield* latest("render", RenderedShort)
        const metadata = yield* latest("metadata", PublishedShort)
        const thumbnail = yield* latest("thumbnail", Thumbnail)
        // the approved thumbnail sits next to the published mp4
        const publishedThumbnail = path.join(home.renders, `${project.slug}.jpg`)
        const thumbnailPublished = yield* fs.exists(publishedThumbnail).pipe(Effect.orElseSucceed(() => false))
        const renderMedia = yield* Option.match(render, {
          onNone: () => Effect.succeed(null),
          onSome: (a) => {
            const folder = path.join("projects", projectId, path.dirname(a.path ?? path.join("render", `v${a.version}`, "x")))
            return Effect.all({
              video: fileIn(folder, a.data.video),
              captions: fileIn(folder, a.data.captions),
              checkSheet: fileIn(folder, a.data.checkSheet)
            })
          }
        })
        const publishedMedia = yield* Option.match(metadata, {
          onNone: () => Effect.succeed(null),
          onSome: (a) =>
            Effect.all({
              video: fileIn(rendersFolder, a.data.video),
              captions: fileIn(rendersFolder, a.data.captions),
              notes: fileIn(rendersFolder, a.data.notes),
              thumbnail: fileIn(rendersFolder, thumbnailPublished ? publishedThumbnail : null)
            })
        })
        const videos = yield* Effect.forEach(sources, (s) =>
          Effect.map(artifacts.latest(s.owner, "source-video"), (video) => ({
            position: s.index,
            source: s.source,
            video: Option.getOrNull(Option.flatMapNullishOr(video, (a) => a.path)),
            seconds: s.seconds
          })))
        const cut = project.format === "cut-down" ? sectionSources(sources) : Option.none<ReadonlyArray<ProjectSource>>()
        const ranking = project.format === "ranking" ? yield* rankingContext(project, sources) : Option.none()

        return {
          project,
          folder: home.projectDir(project.id),
          source,
          videos,
          preset,
          voiceId: project.voiceId ?? preset.config.voice.voiceId,
          scriptLimits: limits === undefined
            ? null
            : {
              narrationWords: [...limits.narrationWords],
              reals: [...limits.reals],
              realsOnlyAtEnd: limits.realsOnlyAtEnd,
              realSeconds: [...limits.realSeconds],
              ending: limits.ending === null ? null : { seconds: [...limits.ending.seconds] },
              wholeSentences: limits.wholeSentences,
              ...(limits.ranking === undefined
                ? {}
                : { ranking: { entries: limits.ranking.entries, realsPerEntry: [...limits.ranking.realsPerEntry], entrySeconds: [...limits.ranking.entrySeconds] } })
            },
          run,
          stages,
          pending,
          script: Option.getOrNull(Option.map(script, (a) => ({ version: a.version, path: a.path, script: a.data }))),
          voiceover: Option.getOrNull(Option.map(voiceover, (a) => ({ version: a.version, path: a.path, voiceover: a.data, words }))),
          shotPlan: Option.getOrNull(Option.map(shotPlan, (a) => ({ version: a.version, path: a.path, plan: a.data }))),
          cutPlan: Option.getOrNull(Option.map(cutPlan, (a) => ({ version: a.version, path: a.path, plan: a.data }))),
          rankingPlan: Option.getOrNull(Option.map(rankingPlan, (a) => ({ version: a.version, path: a.path, plan: a.data }))),
          render: Option.getOrNull(Option.map(render, (a) => ({
            version: a.version,
            path: a.path,
            render: a.data,
            media: renderMedia ?? { video: null, captions: null, checkSheet: null }
          }))),
          metadata: Option.getOrNull(Option.map(metadata, (a) => ({
            version: a.version,
            path: a.path,
            metadata: a.data,
            media: publishedMedia ?? { video: null, captions: null, notes: null, thumbnail: null },
            files: { folder: home.renders, thumbnail: thumbnailPublished ? publishedThumbnail : null }
          }))),
          thumbnail: Option.getOrNull(Option.map(thumbnail, (a) => ({ version: a.version, path: a.path, thumbnail: a.data }))),
          sourceVideo: videos[0]?.video ?? null,
          cutSource: Option.getOrNull(Option.map(cut, (videos) => ({
            videos: videos.map((c) => ({
              words: c.words,
              sourceSeconds: c.seconds,
              excluded: c.excluded.map((r) => ({ start: r.start, end: r.end }))
            })),
            limits: { minSection: SECTION_LIMITS.minSection, total: [...SECTION_LIMITS.total], hookWords: SECTION_LIMITS.hookWords }
          }))),
          rankingSource: Option.getOrNull(Option.map(ranking, (r) => ({
            videos: r.videos.map((v) => ({
              words: v.words,
              sourceSeconds: v.seconds,
              excluded: v.excluded.map((x) => ({ start: x.start, end: x.end })),
              framing: v.framing
            })),
            maxSeconds: r.maxSeconds,
            labelChars: RANKING_LIMITS.labelChars
          })))
        } satisfies ShortWorkspace
      })

      const checkScript = Effect.fn("ShortWorkspaces.checkScript")(function*(projectId: ProjectId, script: Script) {
        const project = yield* projects.get(projectId)
        const limits = scriptLimitsFor(project.approach, project.sourceIds.length)
        if (limits === undefined) return [`${project.approach} shorts don't have a narrated script`]
        const sources = yield* sourcesFor(project)
        if (sources.some((s) => Option.isNone(s.transcript))) return ["the video has no transcript to check the real lines against"]
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.catch(() => presets.getDefault))
        return checkScriptRules(script, limits, sources, preset.config.commentQuestion === true).problems
      })

      // Checked against the voiceover as spoken, the video's length and ads, and where the script's real lines
      // play, exactly as the shots gate checks an edit.
      const checkShots = Effect.fn("ShortWorkspaces.checkShots")(function*(projectId: ProjectId, proposal: ShotProposal) {
        const project = yield* projects.get(projectId)
        const owner = { _tag: "Project", id: projectId } as const
        const script = Option.flatMap(yield* artifacts.latest(owner, "script"), (a) => Schema.decodeUnknownOption(Script)(a.data))
        const voiceover = Option.flatMap(yield* artifacts.latest(owner, "voiceover"), (a) => Schema.decodeUnknownOption(Voiceover)(a.data))
        if (Option.isNone(script) || Option.isNone(voiceover)) return ["the short needs its script and voiceover before its shots"]
        const all = yield* voiceoverWords(owner)
        if (all.length === 0) return ["the voiceover has no word timings yet"]
        // the story's words only: the closing question plays under the end card, with no shots
        const take = storyTake(script.value, all, voiceover.value.durationS)
        const words = take.words
        const reals = placeReals(script.value, words)
        return checkShotsRules(proposal, {
          words,
          voiceoverSeconds: take.seconds,
          sources: yield* sourcesFor(project),
          inserts: reals.inserts,
          ...(project.approach === "narrated-ranking" ? { entries: entriesOnTake(script.value, words, project.sourceIds.length) } : {})
        }).problems
      })

      // Checked against the long video's words, length and ads, exactly as the sections gate checks an edit.
      const checkSections = Effect.fn("ShortWorkspaces.checkSections")(function*(projectId: ProjectId, proposal: SectionsProposal) {
        const project = yield* projects.get(projectId)
        if (project.format !== "cut-down") return ["only cut-down shorts have sections"]
        const sources = sectionSources(yield* sourcesFor(project))
        if (Option.isNone(sources)) return ["the video has no transcript to check the sections against"]
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.catch(() => presets.getDefault))
        return checkSectionsRules(proposal, sources.value, preset.config.commentQuestion === true).problems
      })

      // Checked against each layer's video (its frame size, length and ads), exactly as the thumbnail gate checks an
      // edit.
      const checkThumbnail = Effect.fn("ShortWorkspaces.checkThumbnail")(function*(projectId: ProjectId, config: ThumbConfig) {
        const project = yield* projects.get(projectId)
        const sources = yield* sourcesFor(project)
        const contexts = yield* Effect.forEach(sources, (s) =>
          Effect.gen(function*() {
            if (Option.isNone(s.video)) return null
            const probed = yield* thumbnails.probe(s.video.value).pipe(Effect.option)
            if (Option.isNone(probed)) return null
            return { width: probed.value.width, height: probed.value.height, sourceSeconds: s.source.durationS ?? probed.value.durationS, excluded: s.excluded }
          }))
        const ready = contexts.filter((c) => c !== null)
        if (ready.length < contexts.length) return ["a video's frames can't be read, so the thumbnail can't be checked"]
        return checkConfig(config, ready)
      })

      // Checked and snapped exactly as the moments gate checks an edit (with the framing detected at each new moment).
      const checkRanking = Effect.fn("ShortWorkspaces.checkRanking")(function*(projectId: ProjectId, proposal: RankingProposal) {
        const project = yield* projects.get(projectId)
        if (project.format !== "ranking") return { problems: ["only rankings have moments"], proposal, durationS: 0 }
        const context = yield* rankingContext(project, yield* sourcesFor(project))
        if (Option.isNone(context)) return { problems: ["a video isn't downloaded and transcribed yet, so the ranking can't be checked"], proposal, durationS: 0 }
        const detected = yield* rankingFrames.atShots(context.value.videos.map((v) => v.path), proposal)
        const checked = checkRankingRules(proposal, {
          videos: context.value.videos,
          maxSeconds: context.value.maxSeconds,
          framingAt: (source, start, end) => detected.get(framingKey(source, start, end)) ?? null
        })
        return { problems: checked.problems, proposal: proposalOf(checked.value), durationS: checked.value.durationS }
      })

      return ShortWorkspaces.of({ get, checkScript, checkShots, checkSections, checkThumbnail, checkRanking })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    ProjectSources.layer,
    Presets.layer,
    Artifacts.layer,
    RunStore.layer,
    ThumbnailRenderer.layer,
    RankingFrames.layer,
    VideoSets.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
