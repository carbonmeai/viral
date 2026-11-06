import { NodeServices } from "@effect/platform-node"
import {
  AdRanges,
  type ArtifactKind,
  CutPlan,
  type Project,
  type ProjectId,
  type ProjectNotFound,
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
import { ThumbnailRenderer } from "../thumbnail/thumbnail-renderer.ts"
import { Presets } from "../presets/presets.ts"
import { RunStore } from "../runs/run-store.ts"
import { checkScript as checkScriptRules, SCRIPT_LIMITS } from "../script/script-rules.ts"
import { checkSections as checkSectionsRules, SECTION_LIMITS, type SectionContext } from "../sections/section-rules.ts"
import { checkShots as checkShotsRules, placeReals } from "../shots/shot-rules.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { Sources } from "../sources/sources.ts"
import { Projects } from "./projects.ts"

const TranscriptJson = Schema.fromJsonString(Transcript)

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
}>()("@viral/server/projects/short-workspace/ShortWorkspaces") {
  static readonly layer = Layer.effect(
    ShortWorkspaces,
    Effect.gen(function*() {
      const projects = yield* Projects
      const sources = yield* Sources
      const presets = yield* Presets
      const artifacts = yield* Artifacts
      const store = yield* RunStore
      const transcripts = yield* Transcripts
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const home = yield* ViralHome
      const thumbnails = yield* ThumbnailRenderer

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

      const adRangesOf = (sourceId: Project["sourceId"]) =>
        Effect.map(artifacts.latest({ _tag: "Source", id: sourceId }, "ad-ranges"), (a) =>
          Option.match(Option.flatMap(a, (x) => Schema.decodeUnknownOption(AdRanges)(x.data)), { onNone: () => [], onSome: (r) => r.ranges }))

      // What a cut-down short is cut from: the long video's words, its length and its ads, as the sections stage
      // checks them. None when the video has no transcript yet.
      const sectionContext = Effect.fn("ShortWorkspaces.sectionContext")(function*(project: Project) {
        const transcript = yield* transcripts.forSource(project.sourceId).pipe(Effect.option)
        if (Option.isNone(transcript)) return Option.none<SectionContext>()
        const source = yield* sources.get(project.sourceId).pipe(Effect.orDie)
        return Option.some({
          words: transcript.value.segments.flatMap((s) => s.words),
          sourceSeconds: source.durationS ?? transcript.value.segments.at(-1)?.end ?? 0,
          excluded: yield* adRangesOf(project.sourceId)
        } satisfies SectionContext)
      })

      const get = Effect.fn("ShortWorkspaces.get")(function*(projectId: ProjectId) {
        const project = yield* projects.get(projectId)
        const owner = { _tag: "Project", id: projectId } as const
        const source = yield* sources.get(project.sourceId).pipe(Effect.orDie)
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.catch(() => presets.getDefault))
        const limits = SCRIPT_LIMITS[project.approach]

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
        const sourceVideo = yield* artifacts.latest({ _tag: "Source", id: project.sourceId }, "source-video")
        const cut = project.format === "cut-down" ? yield* sectionContext(project) : Option.none<SectionContext>()

        return {
          project,
          source,
          preset,
          voiceId: project.voiceId ?? preset.config.voice.voiceId,
          scriptLimits: limits === undefined
            ? null
            : { narrationWords: [...limits.narrationWords], reals: [...limits.reals], realsOnlyAtEnd: limits.realsOnlyAtEnd },
          run,
          stages,
          pending,
          script: Option.getOrNull(Option.map(script, (a) => ({ version: a.version, path: a.path, script: a.data }))),
          voiceover: Option.getOrNull(Option.map(voiceover, (a) => ({ version: a.version, path: a.path, voiceover: a.data, words }))),
          shotPlan: Option.getOrNull(Option.map(shotPlan, (a) => ({ version: a.version, path: a.path, plan: a.data }))),
          cutPlan: Option.getOrNull(Option.map(cutPlan, (a) => ({ version: a.version, path: a.path, plan: a.data }))),
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
          sourceVideo: Option.getOrNull(Option.flatMapNullishOr(sourceVideo, (a) => a.path)),
          cutSource: Option.getOrNull(Option.map(cut, (c) => ({
            words: c.words,
            sourceSeconds: c.sourceSeconds,
            excluded: c.excluded.map((r) => ({ start: r.start, end: r.end })),
            limits: { minSection: SECTION_LIMITS.minSection, total: [...SECTION_LIMITS.total], hookWords: SECTION_LIMITS.hookWords }
          })))
        } satisfies ShortWorkspace
      })

      const checkScript = Effect.fn("ShortWorkspaces.checkScript")(function*(projectId: ProjectId, script: Script) {
        const project = yield* projects.get(projectId)
        const limits = SCRIPT_LIMITS[project.approach]
        if (limits === undefined) return [`${project.approach} shorts don't have a narrated script`]
        const transcript = yield* transcripts.forSource(project.sourceId).pipe(Effect.option)
        if (Option.isNone(transcript)) return ["the video has no transcript to check the real lines against"]
        const ads = yield* adRangesOf(project.sourceId)
        return checkScriptRules(script, limits, transcript.value.segments.flatMap((s) => s.words), ads).problems
      })

      // Checked against the voiceover as spoken, the video's length and ads, and where the script's real lines
      // play, exactly as the shots gate checks an edit.
      const checkShots = Effect.fn("ShortWorkspaces.checkShots")(function*(projectId: ProjectId, proposal: ShotProposal) {
        const project = yield* projects.get(projectId)
        const owner = { _tag: "Project", id: projectId } as const
        const script = Option.flatMap(yield* artifacts.latest(owner, "script"), (a) => Schema.decodeUnknownOption(Script)(a.data))
        const voiceover = Option.flatMap(yield* artifacts.latest(owner, "voiceover"), (a) => Schema.decodeUnknownOption(Voiceover)(a.data))
        if (Option.isNone(script) || Option.isNone(voiceover)) return ["the short needs its script and voiceover before its shots"]
        const words = yield* voiceoverWords(owner)
        if (words.length === 0) return ["the voiceover has no word timings yet"]
        const source = yield* sources.get(project.sourceId).pipe(Effect.orDie)
        const sourceSeconds = source.durationS ?? (yield* transcripts.forSource(project.sourceId).pipe(
          Effect.map((t) => t.segments.at(-1)?.end ?? 0),
          Effect.orElseSucceed(() => 0)
        ))
        const reals = placeReals(script.value, words)
        return checkShotsRules(proposal, {
          words,
          voiceoverSeconds: voiceover.value.durationS,
          sourceSeconds,
          excluded: yield* adRangesOf(project.sourceId),
          inserts: reals.inserts
        }).problems
      })

      // Checked against the long video's words, length and ads, exactly as the sections gate checks an edit.
      const checkSections = Effect.fn("ShortWorkspaces.checkSections")(function*(projectId: ProjectId, proposal: SectionsProposal) {
        const project = yield* projects.get(projectId)
        if (project.format !== "cut-down") return ["only cut-down shorts have sections"]
        const ctx = yield* sectionContext(project)
        if (Option.isNone(ctx)) return ["the video has no transcript to check the sections against"]
        return checkSectionsRules(proposal, ctx.value).problems
      })

      // Checked against the long video's frame size and length and its ads, exactly as the thumbnail gate checks
      // an edit.
      const checkThumbnail = Effect.fn("ShortWorkspaces.checkThumbnail")(function*(projectId: ProjectId, config: ThumbConfig) {
        const project = yield* projects.get(projectId)
        const video = Option.flatMapNullishOr(yield* artifacts.latest({ _tag: "Source", id: project.sourceId }, "source-video"), artifacts.resolve)
        if (Option.isNone(video)) return ["the video hasn't been fetched, so the thumbnail can't be checked"]
        const probed = yield* thumbnails.probe(video.value).pipe(Effect.option)
        if (Option.isNone(probed)) return ["the video's frames can't be read to check the thumbnail"]
        const source = yield* sources.get(project.sourceId).pipe(Effect.orDie)
        return checkConfig(config, {
          width: probed.value.width,
          height: probed.value.height,
          sourceSeconds: source.durationS ?? probed.value.durationS,
          excluded: yield* adRangesOf(project.sourceId)
        })
      })

      return ShortWorkspaces.of({ get, checkScript, checkShots, checkSections, checkThumbnail })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    Sources.layer,
    Presets.layer,
    Artifacts.layer,
    RunStore.layer,
    Transcripts.layer,
    ThumbnailRenderer.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
