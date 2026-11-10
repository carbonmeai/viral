import { NodeServices } from "@effect/platform-node"
import {
  type Artifact,
  type ArtifactOwner,
  ChooseThumbnailOption,
  CutPlan,
  type GeneratedThumbnail,
  ProposedThumbnailDesign,
  type GatePayload,
  type ProjectId,
  ProposedThumbnail,
  PublishedShort,
  RankingPlan,
  Script,
  StoryMap,
  ThumbConfig,
  Thumbnail,
  ThumbnailPick,
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
import { checkDesign, checkPick, fromProposedDesign, rankingDesignBrief } from "./thumbnail-design.ts"
import { type Round, ThumbnailImages } from "./thumbnail-images.ts"
import { AI_THUMBNAIL_PROMPT, buildThumbnailBrief, THUMBNAIL_PROMPT } from "./thumbnail-prompt.ts"
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

// the option whose faces matched best, among those made (1-based); null when none was
const bestOption = (options: ReadonlyArray<{ readonly image: string | null; readonly faces: number | null }>) => {
  let best: number | null = null
  options.forEach((o, i) => {
    if (o.image !== null && (best === null || (o.faces ?? 0) > (options[best - 1]!.faces ?? 0))) best = i + 1
  })
  return best
}

// Makes a finished short's thumbnail. With an image key (ElevenLabs), the short-thumbnail skill's way: an agent with
// vision picks the real frames (two or three reactions, the hero, an on-screen graphic) and writes the four bands, the
// image model makes three options from those frames, and the agent checks each option's faces against the real frames
// and recommends one; at the gate you choose one or ask for another round with a note. Without a key, the basic
// thumbnail (Decision 8): the agent picks the hero moment and crop, a reaction face and 2–4 words, and the server
// draws it with render-thumbnail.py. In a short from several videos every frame can come from any of them. Once you
// approve, the jpg is published next to the short's mp4 as <slug>.jpg.
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
      const images = yield* ThumbnailImages
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

      // What both kinds of thumbnail start from: the short's videos, what it says, the overview sheets and the brief.
      const prepare = Effect.fn("ThumbnailStage.prepare")(function*(ctx: StageContext, ai: boolean) {
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
          ai,
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
        return { c, ranking, baseBrief, overviews, detailRoot, previewRoot, projectDir }
      })

      const run = Effect.fn("ThumbnailStage.run")(function*(ctx: StageContext) {
        const ai = yield* images.ready
        const prepared = yield* prepare(ctx, ai)
        if (ai) return yield* runAi(ctx, prepared)
        const { baseBrief, c, detailRoot, overviews, previewRoot, ranking } = prepared
        const [v1] = c.sources
        yield* ctx.progress(null, "no ElevenLabs key, so this is the basic thumbnail (add one in Settings › Accounts for AI thumbnails)")
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

      // ── AI thumbnails ──
      // The agent previews the frames for free, makes one round of options (paid) per attempt, then checks the faces
      // and recommends one. A rejection with a note continues its conversation and makes another round.
      const runAi = Effect.fn("ThumbnailStage.runAi")(function*(ctx: StageContext, prepared: Effect.Success<ReturnType<typeof prepare>>) {
        const { baseBrief, c, detailRoot, overviews, previewRoot, projectDir, ranking } = prepared
        const [v1] = c.sources
        const videos = c.sources.map((s) => ({ index: s.index, path: s.path, source: s.source }))
        const roundDir = path.join(projectDir, "thumbnail-rounds", `${ctx.stageRunId}-${ctx.attempt}`)
        const brief = ranking === null ? baseBrief : `${baseBrief}\n\n${rankingDesignBrief(ranking, c.several)}`
        const checkProposed = (proposed: ProposedThumbnailDesign) => checkDesign(fromProposedDesign(proposed), c.sources)
        const problemsText = (problems: ReadonlyArray<string>) => `Fix these first:\n${problems.map((p) => `- ${p}`).join("\n")}`
        let round: Round | null = null
        let previews = 0

        const previewFrames = agentTool({
          name: "preview_frames",
          description: "Check a thumbnail design and take its real frames from the video (free). Returns the problems to fix, or the frames to Read.",
          schema: ProposedThumbnailDesign,
          run: Effect.fn("ThumbnailStage.previewFrames")(function*(proposed: ProposedThumbnailDesign) {
            const checked = checkProposed(proposed)
            if (checked.problems.length > 0) return problemsText(checked.problems)
            const dir = path.join(previewRoot, `attempt-${ctx.attempt}-${++previews}`)
            const inputs = yield* images.frames(checked.value, videos, dir, () => Effect.void)
            const files = inputs.map((i) => path.join(dir, i.file))
            return toolAnswer([
              "It passes the checks. The frames, in the order the image model numbers them:",
              ...inputs.map((i, n) => `image ${n + 1} (${i.role}): ${files[n]}`),
              "Read them. Is every reaction at its peak, sharp, the face clearly visible? Is the hero recognisable? Fix what isn't, then call generate_thumbnails."
            ].join("\n"), files)
          }, Effect.catch((error) => Effect.succeed(`couldn't take the frames: ${error.message}`)))
        })

        const generate = agentTool({
          name: "generate_thumbnails",
          description: "Make this attempt's one round: the image model composes 3 thumbnails from the design's real frames (paid, about $0.75). " +
            "Returns the options and the real reaction frames to compare their faces with.",
          schema: ProposedThumbnailDesign,
          run: Effect.fn("ThumbnailStage.generate")(function*(proposed: ProposedThumbnailDesign) {
            if (round !== null) return "This attempt's round is already made. Check its faces and call propose_thumbnail."
            const checked = checkProposed(proposed)
            if (checked.problems.length > 0) return problemsText(checked.problems)
            yield* fs.remove(roundDir, { recursive: true }).pipe(Effect.ignore)
            const made = yield* images.make({ design: checked.value, videos, dir: roundDir, projectId: c.project.id, progress: ctx.progress })
            round = made
            if (made.heldBack != null) return `${made.heldBack}\n\nNothing was generated. Call propose_thumbnail with no checks and recommended null.`
            const reactions = made.inputs.flatMap((i) => i.role === "reaction" ? [path.join(roundDir, i.file)] : [])
            const options = made.options.map((o, i) => o.image === null ? `option ${i + 1}: not made (${o.failure})` : `option ${i + 1}: ${path.join(roundDir, o.image)}`)
            const files = [...reactions, ...made.options.flatMap((o) => o.image === null ? [] : [path.join(roundDir, o.image)])]
            if (files.length === reactions.length) {
              return `${options.join("\n")}\n\nNo option was made. Call propose_thumbnail with no checks and recommended null.`
            }
            return toolAnswer([
              "The real reaction frames:",
              ...reactions,
              "",
              "The options:",
              ...options,
              "",
              "Read each option next to the real reaction frames. Score how well its faces match the real person photographically (0–10: 10 = the same " +
              "face, 5 = similar but redrawn, 0 = someone else), and check the words are spelled right and clear of the hero, and the graphic is clean. " +
              "Then call propose_thumbnail with a check per option made and the one to recommend (null when none is good enough)."
            ].join("\n"), files)
          }, Effect.catch((error) => Effect.succeed(`couldn't make the thumbnails: ${error.message}`)))
        })

        const pick = yield* runChecked(agent, ctx, {
          stage: "thumbnail",
          instructions: AI_THUMBNAIL_PROMPT,
          skills: ["thumbnails"],
          brief,
          output: { tool: "propose_thumbnail", description: "Submit your check of the round's options and the one to use.", schema: ThumbnailPick },
          tools: [
            detailSheetTool(contactSheets, path, c.sources.map((s) => ({ video: s.path, seconds: s.sourceSeconds })), v1.sourceSeconds, detailRoot),
            previewFrames,
            generate
          ],
          defaultModel: null,
          readDirs: [...overviews.flatMap((o) => Option.toArray(o.dir)), detailRoot, previewRoot, roundDir],
          maxTurns: 40
        }, (picked) =>
          Effect.sync(() =>
            round === null
              ? { value: picked, problems: ["make the round first: call generate_thumbnails with your design"] }
              : checkPick(picked, round.options)
          )).pipe(Effect.mapError((e) => fail(e.code, e.message)))
        const made = round as Round | null
        if (made === null) return yield* fail("no-round", "the thumbnail agent didn't make a round")
        const options = made.options.map((o, i) => {
          const check = pick.checks.find((x) => x.option === i + 1)
          return check === undefined ? o : { ...o, faces: check.faces, note: check.note }
        })
        const generated: GeneratedThumbnail = { ...made, options, recommended: pick.recommended, chosen: null }
        if (options.length > 0 && options.every((o) => o.image === null)) {
          yield* ctx.progress(null, `no option was made: ${options[0]!.failure ?? "the image model refused"}`)
        }
        // without a recommendation, the best-matching option made is shown (you still choose)
        yield* recordGenerated(ctx, roundDir, generated, pick.recommended ?? bestOption(options))
      })

      // A new thumbnail version from a round: its frames and options copied in from `dir`, `shown` (1-based) in use.
      const recordGenerated = Effect.fn("ThumbnailStage.recordGenerated")(function*(
        ctx: StageContext,
        dir: string,
        generated: GeneratedThumbnail,
        shown: number | null
      ) {
        const slot = yield* artifacts.allocate(ctx.owner, "thumbnail")
        const files = [...generated.inputs.map((i) => i.file), ...generated.options.flatMap((o) => o.image === null ? [] : [o.image])]
        yield* Effect.forEach(files, (file) => fs.copyFile(path.join(dir, file), path.join(slot.dir, file)), { discard: true }).pipe(
          Effect.mapError(failWith("write"))
        )
        const image = shown === null ? null : generated.options[shown - 1]?.image ?? null
        const thumbnail: Thumbnail = { proposal: null, config: null, image, generated }
        // the version's path is the image in use, else its first frame, so its folder is always known
        const file = image ?? generated.inputs[0]?.file ?? null
        yield* artifacts.record(slot, { data: thumbnail, path: file === null ? null : path.join(slot.relDir, file), stageRunId: ctx.stageRunId })
      })

      // An edit sends back the renderer's config: checked, then drawn from this short's own videos.
      const applyEdit = Effect.fn("ThumbnailStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const choice = Schema.decodeUnknownOption(ChooseThumbnailOption)(edited)
        if (Option.isSome(choice)) return yield* choose(ctx, choice.value.choose)
        const config = yield* Schema.decodeUnknownEffect(ThumbConfig)(edited).pipe(Effect.mapError(failWith("invalid-edit")))
        const c = yield* context(ctx)
        const problems = checkConfig(config, c.sources)
        if (problems.length > 0) return yield* fail("invalid-edit", problems.join("; "))
        const { sources: _sent, pieces_by_source: _pieces, ...rest } = config
        yield* record(ctx, null, { ...rest, ...configSources(c.sources) })
      })

      // Choosing one of a round's options: a new version with that option in use, the round's files copied along.
      const choose = Effect.fn("ThumbnailStage.choose")(function*(ctx: StageContext, n: number) {
        const latest = yield* artifacts.latest(ctx.owner, "thumbnail")
        const current = Option.flatMap(latest, (a) => Schema.decodeUnknownOption(Thumbnail)(a.data))
        const generated = Option.getOrUndefined(current)?.generated
        if (generated === undefined) return yield* fail("invalid-edit", "there's no round of AI thumbnails to choose from")
        const option = generated.options[n - 1]
        if (option === undefined || option.image === null) return yield* fail("invalid-edit", `option ${n} wasn't made`)
        const file = Option.getOrNull(Option.flatMapNullishOr(latest, artifacts.resolve))
        if (file === null) return yield* fail("not-ready", "the thumbnail's files are missing")
        yield* recordGenerated(ctx, path.dirname(file), { ...generated, chosen: n }, n)
      })

      // Once approved, the jpg goes next to the published mp4 (an AI round with no option made has nothing to publish).
      const approved = Effect.fn("ThumbnailStage.approved")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const latest = yield* artifacts.latest(ctx.owner, "thumbnail")
        const data = Option.getOrUndefined(Option.flatMap(latest, (a) => Schema.decodeUnknownOption(Thumbnail)(a.data)))
        const image = yield* Effect.fromOption(
          data?.image === null ? Option.none<string>() : Option.flatMapNullishOr(latest, artifacts.resolve)
        ).pipe(
          Effect.mapError(() => fail("not-ready", "there's no thumbnail to publish: ask for another round, or choose an option"))
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
            onSome: (thumbnail): GatePayload => {
              const file = artifacts.resolve(artifact)
              const generated = thumbnail.generated
              if (generated === undefined) return { _tag: "ThumbnailGate", config: thumbnail.config, image: file }
              const dir = file === null ? null : path.dirname(file)
              return {
                _tag: "ThumbnailGate",
                config: null,
                image: thumbnail.image === null ? null : file,
                options: generated.options.map((o) => o.image === null || dir === null ? null : path.join(dir, o.image)),
                recommended: generated.chosen ?? generated.recommended
              }
            }
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
    ThumbnailImages.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
