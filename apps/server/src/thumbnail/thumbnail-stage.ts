import { NodeServices } from "@effect/platform-node"
import {
  AdRanges,
  type Artifact,
  type ArtifactOwner,
  CutPlan,
  type GatePayload,
  type ProjectId,
  PublishedShort,
  Script,
  StoryMap,
  ThumbConfig,
  Thumbnail,
  ThumbnailProposal
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { agentTool, AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ContactSheets, ContactSheetSet } from "../contact-sheet/contact-sheets.ts"
import { detailSheetTool } from "../contact-sheet/detail-sheet-tool.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Projects, sourcesOf } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Sources } from "../sources/sources.ts"
import { buildThumbnailBrief, THUMBNAIL_PROMPT } from "./thumbnail-prompt.ts"
import { Tools } from "../tools/tools.ts"
import { cutoutSummary, drawThumbnail } from "./thumbnail-draw.ts"
import { ThumbnailRenderer } from "./thumbnail-renderer.ts"
import { checkConfig, checkThumbnail, thumbConfig, type ThumbnailContext } from "./thumbnail-rules.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "thumbnail", code, message })
const failWith = (code: string) => (error: { readonly message: string }) => fail(code, error.message)

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the thumbnail stage runs on a project")
  return ctx.owner.id
}

const IMAGE = "thumbnail.jpg"

// Makes a finished short's thumbnail: an agent with vision picks the hero moment and crop, a reaction face and
// 2–4 words, previewing its drafts; the server checks it and draws it in the skill's fixed layout. Gated; once
// you approve, the jpg is published next to the short's mp4 as <slug>.jpg.
export class ThumbnailStage extends Context.Service<ThumbnailStage, {
  readonly stage: StageDefinition
}>()("@viral/server/thumbnail/thumbnail-stage/ThumbnailStage") {
  static readonly layer = Layer.effect(
    ThumbnailStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const contactSheets = yield* ContactSheets
      const renderer = yield* ThumbnailRenderer
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

      // The video the thumbnail is drawn from, and what it's checked against.
      const context = Effect.fn("ThumbnailStage.context")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        // drawn from V1 until thumbnails can mix videos
        const sourceOwner = { _tag: "Source", id: sourcesOf(project)[0] } as const
        const source = yield* sources.get(sourceOwner.id).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const video = yield* Effect.fromOption(Option.flatMapNullishOr(yield* artifacts.latest(sourceOwner, "source-video"), artifacts.resolve)).pipe(
          Effect.mapError(() => fail("not-ready", "the source video hasn't been fetched"))
        )
        const probed = yield* renderer.probe(video).pipe(Effect.mapError(failWith("probe")))
        const excluded = Option.match(yield* latestData(sourceOwner, "ad-ranges", AdRanges), { onNone: () => [], onSome: (a) => a.ranges })
        const thumbContext: ThumbnailContext = {
          width: probed.width,
          height: probed.height,
          sourceSeconds: source.durationS ?? probed.durationS,
          excluded
        }
        return { project, source, sourceOwner, video, thumbContext }
      })

      // Draws the config into a new thumbnail version and records it.
      const record = Effect.fn("ThumbnailStage.record")(function*(
        ctx: StageContext,
        proposal: ThumbnailProposal | null,
        config: ThumbConfig
      ) {
        const slot = yield* artifacts.allocate(ctx.owner, "thumbnail")
        const drawn = yield* draw(config, path.join(slot.dir, IMAGE), ctx.progress).pipe(Effect.mapError(failWith("render")))
        const summary = cutoutSummary(drawn)
        if (summary !== "") yield* ctx.progress(null, `Cut-outs: ${summary}`)
        const thumbnail: Thumbnail = { proposal, config, image: IMAGE }
        yield* artifacts.record(slot, { data: thumbnail, path: path.join(slot.relDir, IMAGE), stageRunId: ctx.stageRunId })
      })

      // The agent's self-check: the thumbnail's problems, or a draft drawn so it can look at it.
      const previewTool = (video: string, thumbContext: ThumbnailContext, root: string, attempt: number) => {
        let drawn = 0
        return agentTool({
          name: "preview_thumbnail",
          description: "Check a thumbnail and draw it. Returns the problems to fix, or the image file to Read.",
          schema: ThumbnailProposal,
          run: Effect.fn("ThumbnailStage.preview")(function*(proposal: ThumbnailProposal) {
            const checked = checkThumbnail(proposal, [thumbContext])
            if (checked.problems.length > 0) return `Fix these first:\n${checked.problems.map((p) => `- ${p}`).join("\n")}`
            const out = path.join(root, `attempt-${attempt}-${++drawn}.jpg`)
            const config = thumbConfig(checked.value, video, thumbContext)
            yield* draw(config, out, () => Effect.void)
            return [
              `It passes the checks. The draft: ${out}`,
              "Read it. At phone size, is the hero recognisable and the face's emotion clear? Fix what isn't, preview again, then call propose_thumbnail."
            ].join("\n\n")
          }, Effect.catch((error) => Effect.succeed(`couldn't draw the preview: ${error.message}`)))
        })
      }

      const run = Effect.fn("ThumbnailStage.run")(function*(ctx: StageContext) {
        const c = yield* context(ctx)
        const published = yield* latestData(ctx.owner, "metadata", PublishedShort)
        const story = yield* latestData(c.sourceOwner, "story-map", StoryMap)
        const lines = c.project.format === "cut-down"
          ? Option.match(yield* latestData(ctx.owner, "cut-plan", CutPlan), { onNone: () => [], onSome: (p) => p.sections.map((s) => `CREATOR (${s.beat}): "${s.text}"`) })
          : Option.match(yield* latestData(ctx.owner, "script", Script), {
            onNone: () => [],
            onSome: (s) => s.beats.map((b) => b._tag === "Narration" ? `NARRATOR: ${b.text}` : `REAL: "${b.quote}"`)
          })

        const sheetsArtifact = yield* artifacts.latest(c.sourceOwner, "contact-sheet")
        const sheetsDir = Option.flatMapNullishOr(sheetsArtifact, artifacts.resolve)
        const sheetSet = Option.flatMap(sheetsArtifact, (a) => Schema.decodeUnknownOption(ContactSheetSet)(a.data))
        const sheets = Option.isSome(sheetsDir) && Option.isSome(sheetSet)
          ? sheetSet.value.sheets.map((s) => `- ${path.join(sheetsDir.value, s.file)}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`)
          : []

        const projectDir = home.projectDir(c.project.id)
        const detailRoot = path.join(projectDir, "thumbnail-detail")
        const previewRoot = path.join(projectDir, "thumbnail-preview")
        yield* Effect.forEach([detailRoot, previewRoot], (dir) => fs.makeDirectory(dir, { recursive: true }), { discard: true }).pipe(
          Effect.mapError(failWith("write"))
        )
        const brief = buildThumbnailBrief({
          creatorBrief: c.project.brief,
          title: Option.match(published, { onNone: () => c.project.title, onSome: (p) => p.title }),
          alternates: Option.match(published, { onNone: () => [], onSome: (p) => p.alternates }),
          video: { title: c.source.title, channel: c.source.channel, width: c.thumbContext.width, height: c.thumbContext.height },
          lines,
          story: Option.getOrNull(story),
          excluded: c.thumbContext.excluded,
          sourceSeconds: c.thumbContext.sourceSeconds,
          sheets
        })
        const proposal = yield* runChecked(agent, ctx, {
          stage: "thumbnail",
          instructions: THUMBNAIL_PROMPT,
          skills: ["thumbnails"],
          brief,
          output: { tool: "propose_thumbnail", description: "Submit the thumbnail.", schema: ThumbnailProposal },
          tools: [
            detailSheetTool(contactSheets, path, c.video, c.thumbContext.sourceSeconds, detailRoot),
            previewTool(c.video, c.thumbContext, previewRoot, ctx.attempt)
          ],
          defaultModel: null,
          readDirs: [...Option.toArray(sheetsDir), detailRoot, previewRoot],
          maxTurns: 40
        }, (proposed) => Effect.succeed(checkThumbnail(proposed, [c.thumbContext]))).pipe(Effect.mapError((e) => fail(e.code, e.message)))
        yield* record(ctx, proposal, thumbConfig(proposal, c.video, c.thumbContext))
      })

      // An edit sends back the renderer's config: checked, then drawn from this project's own video.
      const applyEdit = Effect.fn("ThumbnailStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const config = yield* Schema.decodeUnknownEffect(ThumbConfig)(edited).pipe(Effect.mapError(failWith("invalid-edit")))
        const c = yield* context(ctx)
        const problems = checkConfig(config, c.thumbContext)
        if (problems.length > 0) return yield* fail("invalid-edit", problems.join("; "))
        yield* record(ctx, null, { ...config, source: c.video })
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
    Sources.layer,
    Artifacts.layer,
    ContactSheets.layer,
    ThumbnailRenderer.layer,
    Tools.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
