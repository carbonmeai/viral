import { NodeServices } from "@effect/platform-node"
import {
  type Artifact,
  type ArtifactOwner,
  CutPlan,
  type GatePayload,
  type ProjectId,
  ProposedThumbnail,
  PublishedShort,
  RankingPlan,
  Script,
  StoryMap,
  ThumbConfig,
  Thumbnail,
  type ThumbnailProposal
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { agentTool, AgentSession, toolAnswer } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ContactSheets, ContactSheetSet } from "../contact-sheet/contact-sheets.ts"
import { detailSheetTool } from "../contact-sheet/detail-sheet-tool.ts"
import { ViralHome } from "../home/viral-home.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { Projects } from "../projects/projects.ts"
import { sourceLabel } from "../projects/source-context.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import type { Range } from "../sources/piece-ranges.ts"
import { SourcePieces } from "../sources/source-pieces.ts"
import { loadShortStory } from "../video-sets/short-story.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { buildThumbnailBrief, THUMBNAIL_PROMPT } from "./thumbnail-prompt.ts"
import { Tools } from "../tools/tools.ts"
import { cutoutSummary, drawThumbnail } from "./thumbnail-draw.ts"
import { checkRankingThumbnail, rankingThumbnailBrief, tiltInset } from "./ranking-thumbnail.ts"
import { ThumbnailRenderer } from "./thumbnail-renderer.ts"
import {
  checkConfig,
  checkThumbnail,
  configSources,
  fromProposedThumbnail,
  thumbConfig,
  type ThumbnailContext,
  type ThumbnailVideo
} from "./thumbnail-rules.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "thumbnail", code, message })
const failWith = (code: string) => (error: { readonly message: string }) => fail(code, error.message)

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the thumbnail stage runs on a project")
  return ctx.owner.id
}

const IMAGE = "thumbnail.jpg"

// Makes a finished short's thumbnail: an agent with vision picks the hero moment and crop, a reaction face and
// 2–4 words, previewing its drafts; the server checks it and draws it in the skill's fixed layout. In a short from
// several videos it sees every video's contact sheets, and the hero and the face can each come from any of them.
// Gated; once you approve, the jpg is published next to the short's mp4 as <slug>.jpg.
export class ThumbnailStage extends Context.Service<ThumbnailStage, {
  readonly stage: StageDefinition
}>()("@viral/server/thumbnail/thumbnail-stage/ThumbnailStage") {
  static readonly layer = Layer.effect(
    ThumbnailStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const projectSources = yield* ProjectSources
      const sets = yield* VideoSets
      const artifacts = yield* Artifacts
      const contactSheets = yield* ContactSheets
      const renderer = yield* ThumbnailRenderer
      const sourcePieces = yield* SourcePieces
      const tools = yield* Tools
      // A bold thumbnail's cut-outs: Apple's first (nothing to download); rembg's models are fetched, with
      // progress, only when a layer needs them, then the thumbnail is drawn again.
      const draw = (config: ThumbConfig, out: string, progress: (pct: number | null, message: string) => Effect.Effect<void>) =>
        drawThumbnail(renderer.render(config, out), tools.ensureBackgroundRemoval(progress))
      const agent = yield* AgentSession
      const home = yield* ViralHome
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const latestData = <S extends Schema.Codec<unknown, unknown>>(owner: ArtifactOwner, kind: Artifact["kind"], schema: S) =>
        Effect.map(artifacts.latest(owner, kind), Option.flatMap((a) => Schema.decodeUnknownOption(schema)(a.data)))

      // The short's videos the thumbnail is drawn from (V1 first): each one's file, frame size, length and ads.
      const context = Effect.fn("ThumbnailStage.context")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const sources = yield* projectSources.of(project).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const several = sources.length > 1
        const videos = yield* Effect.forEach(sources, (s) =>
          Effect.gen(function*() {
            const video = yield* Effect.fromOption(s.video).pipe(
              Effect.mapError(() => fail("not-ready", several ? `${sourceLabel(s.index)}'s video hasn't been fetched` : "the source video hasn't been fetched"))
            )
            const probed = yield* renderer.probe(video).pipe(Effect.mapError(failWith("probe")))
            return {
              ...s,
              path: video,
              width: probed.width,
              height: probed.height,
              sourceSeconds: s.source.durationS ?? probed.durationS
            } satisfies ThumbnailContext & ThumbnailVideo & typeof s
          }))
        return { project, sources: videos, several }
      })

      // Draws the config into a new thumbnail version and records it.
      const record = Effect.fn("ThumbnailStage.record")(function*(
        ctx: StageContext,
        proposal: ThumbnailProposal | null,
        config: ThumbConfig
      ) {
        // a video read from a 480p scan gives its frames from 1080p pieces around each layer's second (the agent's
        // drafts used the scan); the stored config never carries the pieces
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const videos = yield* projectSources.of(project).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const moments = new Map<number, Array<Range>>()
        for (const layer of [...(config.layout === "bold" ? [] : [config.background]), config.hero, ...(config.inset === undefined ? [] : [config.inset])]) {
          moments.set(layer.source ?? 0, [...(moments.get(layer.source ?? 0) ?? []), { start: Math.max(0, layer.src - 0.5), end: layer.src + 0.5 }])
        }
        const footage = yield* sourcePieces.forShort(
          videos.flatMap((v) => {
            const ranges = moments.get(v.index)
            return ranges === undefined ? [] : [{ index: v.index, source: v.source, ranges }]
          }),
          ctx.progress
        )
        const problems = footage.videos.flatMap((v) => v.problem === null ? [] : [`${sourceLabel(v.index)}: ${v.problem}`])
        if (problems.length > 0) yield* ctx.progress(null, `the thumbnail is drawn from the 480p reading copy (${problems.join("; ")})`)
        const drawing: ThumbConfig = footage.piecesBySource === undefined ? config : { ...config, pieces_by_source: footage.piecesBySource }
        const slot = yield* artifacts.allocate(ctx.owner, "thumbnail")
        const drawn = yield* draw(drawing, path.join(slot.dir, IMAGE), ctx.progress).pipe(Effect.mapError(failWith("render")))
        const summary = cutoutSummary(drawn)
        if (summary !== "") yield* ctx.progress(null, `Cut-outs: ${summary}`)
        const thumbnail: Thumbnail = { proposal, config, image: IMAGE }
        yield* artifacts.record(slot, { data: thumbnail, path: path.join(slot.relDir, IMAGE), stageRunId: ctx.stageRunId })
      })

      // The agent's self-check: the thumbnail's problems, or a draft drawn so it can look at it.
      const previewTool = (videos: ReadonlyArray<ThumbnailContext & ThumbnailVideo>, root: string, attempt: number, ranking: RankingPlan | null) => {
        let drawn = 0
        return agentTool({
          name: "preview_thumbnail",
          description: videos.length > 1
            ? "Check a thumbnail and draw it (each layer's `video` picks its V number). Returns the problems to fix, or the image file to Read."
            : "Check a thumbnail and draw it. Returns the problems to fix, or the image file to Read.",
          schema: ProposedThumbnail,
          run: Effect.fn("ThumbnailStage.preview")(function*(proposed: ProposedThumbnail) {
            const checked = withRanking(checkThumbnail(fromProposedThumbnail(proposed), videos), ranking)
            if (checked.problems.length > 0) return `Fix these first:\n${checked.problems.map((p) => `- ${p}`).join("\n")}`
            const out = path.join(root, `attempt-${attempt}-${++drawn}.jpg`)
            const config = configFor(checked.value, videos, ranking)
            yield* draw(config, out, () => Effect.void)
            return toolAnswer([
              `It passes the checks. The draft: ${out}`,
              "Read it. At phone size, is the hero recognisable and the face's emotion clear? Fix what isn't, preview again, then call propose_thumbnail."
            ].join("\n\n"), [out])
          }, Effect.catch((error) => Effect.succeed(`couldn't draw the preview: ${error.message}`)))
        })
      }

      // a ranking's thumbnail is #1's after with #1's before as a tilted inset
      const withRanking = (checked: ReturnType<typeof checkThumbnail>, ranking: RankingPlan | null) =>
        ranking === null ? checked : { ...checked, problems: [...checked.problems, ...checkRankingThumbnail(checked.value, ranking)] }
      const configFor = (proposal: ThumbnailProposal, videos: ReadonlyArray<ThumbnailContext & ThumbnailVideo>, ranking: RankingPlan | null) =>
        ranking === null ? thumbConfig(proposal, videos) : tiltInset(thumbConfig(proposal, videos))

      // a video's overview contact sheets, as lines for the brief, and their folder for the agent to read
      const overviewSheets = Effect.fn("ThumbnailStage.overviewSheets")(function*(owner: ArtifactOwner) {
        const sheetsArtifact = yield* artifacts.latest(owner, "contact-sheet")
        const sheetsDir = Option.flatMapNullishOr(sheetsArtifact, artifacts.resolve)
        const sheetSet = Option.flatMap(sheetsArtifact, (a) => Schema.decodeUnknownOption(ContactSheetSet)(a.data))
        const sheets = Option.isSome(sheetsDir) && Option.isSome(sheetSet)
          ? sheetSet.value.sheets.map((s) => `- ${path.join(sheetsDir.value, s.file)}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`)
          : []
        return { sheets, dir: sheetsDir }
      })

      const run = Effect.fn("ThumbnailStage.run")(function*(ctx: StageContext) {
        const c = yield* context(ctx)
        const [v1] = c.sources
        const published = yield* latestData(ctx.owner, "metadata", PublishedShort)
        const story = yield* latestData(v1.owner, "story-map", StoryMap)
        const label = (source: number | undefined) => c.several ? `V${(source ?? 0) + 1}, ` : ""
        const ranking = c.project.format === "ranking" ? Option.getOrNull(yield* latestData(ctx.owner, "ranking-plan", RankingPlan)) : null
        const lines = ranking !== null
          ? [...ranking.entries].sort((a, b) => a.rank - b.rank).map((e) => `#${e.rank} ${e.label} ${e.emoji} (${label(e.source)}${e.shots.map((s) => s.role).join(" → ")})`)
          : c.project.format === "cut-down"
          ? Option.match(yield* latestData(ctx.owner, "cut-plan", CutPlan), {
            onNone: () => [],
            onSome: (p) => p.sections.map((s) => `CREATOR (${label(s.source)}${s.beat}): "${s.text}"`)
          })
          : Option.match(yield* latestData(ctx.owner, "script", Script), {
            onNone: () => [],
            onSome: (s) => s.beats.map((b) => b._tag === "Narration" ? `NARRATOR: ${b.text}` : c.several ? `REAL (V${(b.source ?? 0) + 1}): "${b.quote}"` : `REAL: "${b.quote}"`)
          })
        const overviews = yield* Effect.forEach(c.sources, (s) => overviewSheets(s.owner))

        const projectDir = home.projectDir(c.project.id)
        const detailRoot = path.join(projectDir, "thumbnail-detail")
        const previewRoot = path.join(projectDir, "thumbnail-preview")
        yield* Effect.forEach([detailRoot, previewRoot], (dir) => fs.makeDirectory(dir, { recursive: true }), { discard: true }).pipe(
          Effect.mapError(failWith("write"))
        )
        const shortStory = c.several ? yield* loadShortStory(c.project, artifacts, sets) : null
        const baseBrief = buildThumbnailBrief({
          creatorBrief: c.project.brief,
          title: Option.match(published, { onNone: () => c.project.title, onSome: (p) => p.title }),
          alternates: Option.match(published, { onNone: () => [], onSome: (p) => p.alternates }),
          video: { title: v1.source.title, channel: v1.source.channel, width: v1.width, height: v1.height },
          lines,
          story: Option.getOrNull(story),
          excluded: v1.excluded,
          sourceSeconds: v1.sourceSeconds,
          sheets: overviews[0]!.sheets,
          ...(c.several
            ? {
              videos: c.sources.map((s, i) => ({
                title: s.source.title,
                channel: s.source.channel,
                seconds: s.sourceSeconds,
                width: s.width,
                height: s.height,
                excluded: s.ads,
                sheets: overviews[i]!.sheets
              })),
              beats: shortStory?.beats ?? []
            }
            : {})
        })
        const brief = ranking === null ? baseBrief : `${baseBrief}\n\n${rankingThumbnailBrief(ranking, c.several)}`
        const proposal = yield* runChecked(agent, ctx, {
          stage: "thumbnail",
          instructions: THUMBNAIL_PROMPT,
          skills: ["thumbnails"],
          brief,
          output: { tool: "propose_thumbnail", description: "Submit the thumbnail.", schema: ProposedThumbnail },
          tools: [
            detailSheetTool(contactSheets, path, c.sources.map((s) => ({ video: s.path, seconds: s.sourceSeconds })), v1.sourceSeconds, detailRoot),
            previewTool(c.sources, previewRoot, ctx.attempt, ranking)
          ],
          defaultModel: null,
          readDirs: [...overviews.flatMap((o) => Option.toArray(o.dir)), detailRoot, previewRoot],
          maxTurns: 40
        }, (proposed) => Effect.succeed(withRanking(checkThumbnail(fromProposedThumbnail(proposed), c.sources), ranking))).pipe(
          Effect.mapError((e) => fail(e.code, e.message))
        )
        yield* record(ctx, proposal, configFor(proposal, c.sources, ranking))
      })

      // An edit sends back the renderer's config: checked, then drawn from this short's own videos.
      const applyEdit = Effect.fn("ThumbnailStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const config = yield* Schema.decodeUnknownEffect(ThumbConfig)(edited).pipe(Effect.mapError(failWith("invalid-edit")))
        const c = yield* context(ctx)
        const problems = checkConfig(config, c.sources)
        if (problems.length > 0) return yield* fail("invalid-edit", problems.join("; "))
        const { sources: _sent, pieces_by_source: _pieces, ...rest } = config
        yield* record(ctx, null, { ...rest, ...configSources(c.sources) })
      })

      // Once approved, the jpg goes next to the published mp4.
      const approved = Effect.fn("ThumbnailStage.approved")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const image = yield* Effect.fromOption(Option.flatMapNullishOr(yield* artifacts.latest(ctx.owner, "thumbnail"), artifacts.resolve)).pipe(
          Effect.mapError(() => fail("not-ready", "there's no thumbnail to publish"))
        )
        yield* fs.copyFile(image, path.join(home.renders, `${project.slug}.jpg`)).pipe(Effect.mapError(failWith("publish")))
      })

      const stage: StageDefinition = {
        name: "thumbnail",
        artifact: "thumbnail",
        gate: "Approve the thumbnail?",
        run,
        applyEdit,
        approved,
        gatePayload: (artifact: Artifact): GatePayload =>
          Option.match(Schema.decodeUnknownOption(Thumbnail)(artifact.data), {
            onNone: () => ({ _tag: "ArtifactGate", artifact }),
            onSome: (thumbnail) => ({ _tag: "ThumbnailGate", config: thumbnail.config, image: artifacts.resolve(artifact) })
          })
      }
      return ThumbnailStage.of({ stage })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    ProjectSources.layer,
    VideoSets.layer,
    Artifacts.layer,
    ContactSheets.layer,
    ThumbnailRenderer.layer,
    SourcePieces.layer,
    Tools.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
