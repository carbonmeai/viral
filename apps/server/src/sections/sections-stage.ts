import { NodeServices } from "@effect/platform-node"
import {
  type Artifact,
  type ArtifactOwner,
  CutPlan,
  type GatePayload,
  type ProjectId,
  ProposedSections,
  SectionsProposal,
  StoryMap
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { agentTool, AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { approachSkill } from "../agent-skills/skill-pack.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ContactSheets, ContactSheetSet } from "../contact-sheet/contact-sheets.ts"
import { detailSheetTool } from "../contact-sheet/detail-sheet-tool.ts"
import { ViralHome } from "../home/viral-home.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { Projects } from "../projects/projects.ts"
import { fitsInline } from "../projects/videos-brief.ts"
import type { SourceContext } from "../projects/source-context.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { ScriptRunner } from "../script-runner/script-runner.ts"
import { transcriptTools } from "../set-story/transcript-tools.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { loadShortStory } from "../video-sets/short-story.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { checkSections, type CutDraft, fromProposedSections } from "./section-rules.ts"
import { buildSectionsBrief, SECTIONS_PROMPT } from "./sections-prompt.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "sections", code, message })
const failWith = (code: string) => (error: { readonly message: string }) => fail(code, error.message)

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the sections stage runs on a project")
  return ctx.owner.id
}

const StoryboardLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), done: Schema.Int, total: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("done"), tiles: Schema.Int })
]))
const StoryboardSpec = Schema.fromJsonString(Schema.Struct({
  cols: Schema.Int,
  tiles: Schema.Array(Schema.Struct({
    t: Schema.Finite,
    label: Schema.String,
    kind: Schema.Literals(["shot", "real"]),
    file: Schema.String,
    // the tile's own video, in a short from several videos (else the storyboard's)
    video: Schema.optionalKey(Schema.String)
  }))
}))

const frameFile = (index: number) => `frames/section-${String(index + 1).padStart(2, "0")}.jpg`
const firstWords = (text: string, n: number) => {
  const words = text.split(/\s+/).filter((w) => w !== "")
  return words.length <= n ? text : `${words.slice(0, n).join(" ")}…`
}

// "V2 " before a section in a short from several videos; nothing in a single-video short
const videoTag = (videos: ReadonlyArray<string>, source: number | undefined) => videos.length > 1 ? `V${(source ?? 0) + 1} ` : ""

// One storyboard tile per section in playing order, a moment after its first word, saved on its own too. In a
// short from several videos (`videos`, V1 first) each tile is drawn from its own video and labelled with its V.
const storyboardTiles = (draft: CutDraft, videos: ReadonlyArray<string>) =>
  draft.sections.map((section, k) => ({
    t: Math.min(section.start + 0.3, section.end),
    label: `${k + 1} ${videoTag(videos, section.source)}${section.beat} "${firstWords(section.text, 4)}"`,
    kind: "shot" as const,
    file: frameFile(k),
    ...(videos.length > 1 ? { video: videos[section.source ?? 0] ?? videos[0]! } : {})
  }))

// Plans a cut-down short: an agent picks the creator's best stretches of speech by story beat, hook first,
// looking at the frames to choose each section's framing. The server snaps them to whole words, checks them,
// and draws a storyboard for the gate.
export class SectionsStage extends Context.Service<SectionsStage, {
  readonly stage: StageDefinition
}>()("@viral/server/sections/sections-stage/SectionsStage") {
  static readonly layer = Layer.effect(
    SectionsStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const projectSources = yield* ProjectSources
      const artifacts = yield* Artifacts
      const transcripts = yield* Transcripts
      const sets = yield* VideoSets
      const contactSheets = yield* ContactSheets
      const scripts = yield* ScriptRunner
      const agent = yield* AgentSession
      const home = yield* ViralHome
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const latestData = <S extends Schema.Codec<unknown, unknown>>(owner: ArtifactOwner, kind: Artifact["kind"], schema: S) =>
        Effect.map(artifacts.latest(owner, kind), Option.flatMap((a) => Schema.decodeUnknownOption(schema)(a.data)))

      // Everything the plan is made from and checked against.
      const context = Effect.fn("SectionsStage.context")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        if (project.format !== "cut-down") return yield* fail("wrong-approach", `${project.approach} shorts aren't cut down`)
        const sources = yield* projectSources.of(project).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const [v1] = sources
        const one = sources.length === 1
        const unfetched = sources.filter((s) => Option.isNone(s.video)).map((s) => `V${s.index + 1}`)
        if (unfetched.length > 0) return yield* fail("not-ready", one ? "the source video hasn't been fetched" : `${unfetched.join(", ")} hasn't been fetched`)
        const untranscribed = sources.filter((s) => Option.isNone(s.transcript)).map((s) => `V${s.index + 1}`)
        if (untranscribed.length > 0) return yield* fail("not-ready", one ? "the source has no transcript" : `${untranscribed.join(", ")} has no transcript`)
        // every video's file, V1 first
        const videos = sources.map((s) => Option.getOrThrow(s.video))
        const transcript = Option.getOrThrow(v1.transcript)
        const sectionContext: SourceContext = v1
        return { project, source: v1.source, sourceOwner: v1.owner, videos, transcript, sources, sectionContext }
      })

      // Draws a plan's frames (frames/section-NN.jpg) and their storyboard into `dir`; null when it couldn't.
      const draw = Effect.fn("SectionsStage.draw")(function*(videos: ReadonlyArray<string>, draft: CutDraft, dir: string) {
        const spec = path.join(dir, "storyboard.json")
        const video = videos[0]!
        yield* Schema.encodeEffect(StoryboardSpec)({ cols: 6, tiles: storyboardTiles(draft, videos) }).pipe(
          Effect.flatMap((json) => fs.writeFileString(spec, json)),
          Effect.mapError(failWith("write"))
        )
        return yield* scripts.run(
          [path.join(import.meta.dirname, "..", "shots", "storyboard.py"), video, spec, path.join(dir, "storyboard.png")],
          Schema.decodeEffect(StoryboardLine),
          (line) => Effect.succeed(line.type === "done" ? "storyboard.png" : undefined)
        ).pipe(
          Effect.tapError((error) => Effect.logWarning("no storyboard", { error: error.message })),
          Effect.orElseSucceed(() => null)
        )
      })

      // The agent's self-check: the plan's problems, or each section's first frame drawn so it can see them.
      const previewTool = (videos: ReadonlyArray<string>, sources: ReadonlyArray<SourceContext>, root: string, attempt: number) => {
        let drawn = 0
        return agentTool({
          name: "preview_sections",
          description: "Check a cut-down plan and draw each section's first frame. Returns the problems to fix, or the storyboard and frame files to Read.",
          schema: ProposedSections,
          run: Effect.fn("SectionsStage.preview")(function*(proposed: ProposedSections) {
            const checked = checkSections(fromProposedSections(proposed), sources)
            if (checked.problems.length > 0) return `Fix these first:\n${checked.problems.map((p) => `- ${p}`).join("\n")}`
            const dir = path.join(root, `attempt-${attempt}-${++drawn}`)
            yield* fs.makeDirectory(dir, { recursive: true })
            const storyboard = yield* draw(videos, checked.value, dir)
            const total = checked.value.sections.reduce((n, s) => n + s.end - s.start, 0)
            if (storyboard === null) return `The plan passes the checks (${total.toFixed(1)}s), but its frames couldn't be drawn; submit it.`
            const frames = checked.value.sections.map((s, k) =>
              `- section ${k + 1} (${s.beat}, ${videoTag(videos, s.source)}${s.start.toFixed(1)}–${s.end.toFixed(1)}s, "${firstWords(s.text, 8)}"): ${path.join(dir, frameFile(k))}`
            )
            return [
              `The plan passes the checks and runs ${total.toFixed(1)}s. Storyboard (every section in playing order): ${path.join(dir, storyboard)}`,
              `Each section's first frame:\n${frames.join("\n")}`,
              "Read the storyboard. Fix any section whose framing or moment is wrong, then call propose_sections."
            ].join("\n\n")
          }, Effect.catch((error) => Effect.succeed(`couldn't draw the preview: ${error.message}`)))
        })
      }

      const record = Effect.fn("SectionsStage.record")(function*(ctx: StageContext, videos: ReadonlyArray<string>, draft: CutDraft) {
        const slot = yield* artifacts.allocate(ctx.owner, "cut-plan")
        const storyboard = yield* draw(videos, draft, slot.dir)
        const plan: CutPlan = {
          hookText: draft.hookText,
          sections: draft.sections.map((s, k) => ({ ...s, frame: storyboard === null ? null : frameFile(k) })),
          storyboard
        }
        yield* artifacts.record(slot, {
          data: plan,
          path: storyboard === null ? null : path.join(slot.relDir, storyboard),
          stageRunId: ctx.stageRunId
        })
      })

      // a video's overview contact sheets, as lines for the brief, and their folder for the agent to read
      const overviewSheets = Effect.fn("SectionsStage.overviewSheets")(function*(owner: ArtifactOwner) {
        const sheetsArtifact = yield* artifacts.latest(owner, "contact-sheet")
        const sheetsDir = Option.flatMapNullishOr(sheetsArtifact, artifacts.resolve)
        const sheetSet = Option.flatMap(sheetsArtifact, (a) => Schema.decodeUnknownOption(ContactSheetSet)(a.data))
        const sheets = Option.isSome(sheetsDir) && Option.isSome(sheetSet)
          ? sheetSet.value.sheets.map((s) => `- ${path.join(sheetsDir.value, s.file)}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`)
          : []
        return { sheets, dir: sheetsDir }
      })

      const run = Effect.fn("SectionsStage.run")(function*(ctx: StageContext) {
        const c = yield* context(ctx)
        const several = c.sources.length > 1
        const story = yield* latestData(c.sourceOwner, "story-map", StoryMap)
        // one video: its own story proposal; several: the set's proposal and beats, or each video's own beats
        const shortStory = several ? yield* loadShortStory(c.project, artifacts, sets) : null
        const proposal = Option.flatMapNullishOr(story, (m) => m.proposals.find((p) => p.approach === c.project.approach))
        const overviews = yield* Effect.forEach(c.sources, (s) => overviewSheets(s.owner))

        const projectDir = home.projectDir(c.project.id)
        const detailRoot = path.join(projectDir, "sections-detail")
        const previewRoot = path.join(projectDir, "sections-preview")
        yield* Effect.forEach([detailRoot, previewRoot], (dir) => fs.makeDirectory(dir, { recursive: true }), { discard: true }).pipe(
          Effect.mapError(failWith("write"))
        )
        const briefVideos = c.sources.map((s, i) => ({
          title: s.source.title,
          channel: s.source.channel,
          seconds: s.seconds,
          transcript: Option.getOrNull(s.transcript),
          excluded: s.ads,
          sheets: overviews[i]!.sheets
        }))
        const brief = buildSectionsBrief({
          creatorBrief: c.project.brief,
          title: c.source.title,
          channel: c.source.channel,
          angle: shortStory !== null
            ? shortStory.angle
            : Option.match(proposal, { onNone: () => null, onSome: ({ title, hook, why }) => ({ title, hook, why }) }),
          story: Option.getOrNull(story),
          excluded: c.sectionContext.excluded,
          sourceSeconds: c.sectionContext.seconds,
          sheets: overviews[0]!.sheets,
          transcript: transcripts.timedText(c.transcript),
          ...(several ? { videos: briefVideos, beats: shortStory?.beats ?? [] } : {})
        })
        // long transcripts come as outlines, read further with the transcript tools
        const readers = several && !fitsInline(briefVideos) ? transcriptTools(briefVideos, "short") : []
        const draft = yield* runChecked(agent, ctx, {
          stage: "sections",
          instructions: SECTIONS_PROMPT,
          skills: ["story-arc", approachSkill(c.project.approach)],
          brief,
          output: { tool: "propose_sections", description: "Submit the whole cut-down plan.", schema: ProposedSections },
          tools: [
            detailSheetTool(contactSheets, path, c.sources.map((s, i) => ({ video: c.videos[i]!, seconds: s.seconds })), c.sectionContext.seconds, detailRoot),
            previewTool(c.videos, c.sources, previewRoot, ctx.attempt),
            ...readers
          ],
          defaultModel: null,
          readDirs: [...overviews.flatMap((o) => Option.toArray(o.dir)), detailRoot, previewRoot],
          maxTurns: 60
        }, (proposed) => Effect.succeed(checkSections(fromProposedSections(proposed), c.sources))).pipe(Effect.mapError((e) => fail(e.code, e.message)))
        yield* record(ctx, c.videos, draft)
      })

      // An edit sends back the hook text and sections; they're snapped and checked again.
      const applyEdit = Effect.fn("SectionsStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const proposal = yield* Schema.decodeUnknownEffect(SectionsProposal)(edited).pipe(Effect.mapError(failWith("invalid-edit")))
        const c = yield* context(ctx)
        const checked = checkSections(proposal, c.sources)
        if (checked.problems.length > 0) return yield* fail("invalid-edit", checked.problems.join("; "))
        yield* record(ctx, c.videos, checked.value)
      })

      const stage: StageDefinition = {
        name: "sections",
        artifact: "cut-plan",
        gate: "Approve the sections?",
        run,
        applyEdit,
        gatePayload: (artifact: Artifact): GatePayload =>
          Option.match(Schema.decodeUnknownOption(CutPlan)(artifact.data), {
            onNone: () => ({ _tag: "ArtifactGate", artifact }),
            onSome: (plan) => ({ _tag: "SectionsGate", plan, storyboard: artifacts.resolve(artifact) })
          })
      }
      return SectionsStage.of({ stage })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    ProjectSources.layer,
    Artifacts.layer,
    Transcripts.layer,
    ContactSheets.layer,
    VideoSets.layer,
    ScriptRunner.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
