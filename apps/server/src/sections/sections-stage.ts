import { NodeServices } from "@effect/platform-node"
import {
  AdRanges,
  type Artifact,
  type ArtifactOwner,
  CutPlan,
  type GatePayload,
  type ProjectId,
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
import { Projects } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { ScriptRunner } from "../script-runner/script-runner.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { checkSections, type CutDraft, type SectionContext } from "./section-rules.ts"
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
  tiles: Schema.Array(Schema.Struct({ t: Schema.Finite, label: Schema.String, kind: Schema.Literals(["shot", "real"]), file: Schema.String }))
}))

const frameFile = (index: number) => `frames/section-${String(index + 1).padStart(2, "0")}.jpg`
const firstWords = (text: string, n: number) => {
  const words = text.split(/\s+/).filter((w) => w !== "")
  return words.length <= n ? text : `${words.slice(0, n).join(" ")}…`
}

// One storyboard tile per section in playing order, a moment after its first word, saved on its own too.
const storyboardTiles = (draft: CutDraft) =>
  draft.sections.map((section, k) => ({
    t: Math.min(section.start + 0.3, section.end),
    label: `${k + 1} ${section.beat} "${firstWords(section.text, 4)}"`,
    kind: "shot" as const,
    file: frameFile(k)
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
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const transcripts = yield* Transcripts
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
        const sourceOwner = { _tag: "Source", id: project.sourceId } as const
        const source = yield* sources.get(project.sourceId).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const video = yield* Effect.fromOption(Option.flatMapNullishOr(yield* artifacts.latest(sourceOwner, "source-video"), artifacts.resolve)).pipe(
          Effect.mapError(() => fail("not-ready", "the source video hasn't been fetched"))
        )
        const transcript = yield* transcripts.forSource(project.sourceId).pipe(Effect.mapError(() => fail("not-ready", "the source has no transcript")))
        const words = transcript.segments.flatMap((s) => s.words)
        const excluded = Option.match(yield* latestData(sourceOwner, "ad-ranges", AdRanges), { onNone: () => [], onSome: (a) => a.ranges })
        const sourceSeconds = source.durationS ?? transcript.segments.at(-1)?.end ?? 0
        const sectionContext: SectionContext = { words, sourceSeconds, excluded }
        return { project, source, sourceOwner, video, transcript, sectionContext }
      })

      // Draws a plan's frames (frames/section-NN.jpg) and their storyboard into `dir`; null when it couldn't.
      const draw = Effect.fn("SectionsStage.draw")(function*(video: string, draft: CutDraft, dir: string) {
        const spec = path.join(dir, "storyboard.json")
        yield* Schema.encodeEffect(StoryboardSpec)({ cols: 6, tiles: storyboardTiles(draft) }).pipe(
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
      const previewTool = (video: string, sectionContext: SectionContext, root: string, attempt: number) => {
        let drawn = 0
        return agentTool({
          name: "preview_sections",
          description: "Check a cut-down plan and draw each section's first frame. Returns the problems to fix, or the storyboard and frame files to Read.",
          schema: SectionsProposal,
          run: Effect.fn("SectionsStage.preview")(function*(proposal: SectionsProposal) {
            const checked = checkSections(proposal, sectionContext)
            if (checked.problems.length > 0) return `Fix these first:\n${checked.problems.map((p) => `- ${p}`).join("\n")}`
            const dir = path.join(root, `attempt-${attempt}-${++drawn}`)
            yield* fs.makeDirectory(dir, { recursive: true })
            const storyboard = yield* draw(video, checked.value, dir)
            const total = checked.value.sections.reduce((n, s) => n + s.end - s.start, 0)
            if (storyboard === null) return `The plan passes the checks (${total.toFixed(1)}s), but its frames couldn't be drawn; submit it.`
            const frames = checked.value.sections.map((s, k) =>
              `- section ${k + 1} (${s.beat}, ${s.start.toFixed(1)}–${s.end.toFixed(1)}s, "${firstWords(s.text, 8)}"): ${path.join(dir, frameFile(k))}`
            )
            return [
              `The plan passes the checks and runs ${total.toFixed(1)}s. Storyboard (every section in playing order): ${path.join(dir, storyboard)}`,
              `Each section's first frame:\n${frames.join("\n")}`,
              "Read the storyboard. Fix any section whose framing or moment is wrong, then call propose_sections."
            ].join("\n\n")
          }, Effect.catch((error) => Effect.succeed(`couldn't draw the preview: ${error.message}`)))
        })
      }

      const record = Effect.fn("SectionsStage.record")(function*(ctx: StageContext, video: string, draft: CutDraft) {
        const slot = yield* artifacts.allocate(ctx.owner, "cut-plan")
        const storyboard = yield* draw(video, draft, slot.dir)
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

      const run = Effect.fn("SectionsStage.run")(function*(ctx: StageContext) {
        const c = yield* context(ctx)
        const story = yield* latestData(c.sourceOwner, "story-map", StoryMap)
        const proposal = Option.flatMapNullishOr(story, (m) => m.proposals.find((p) => p.approach === c.project.approach))

        const sheetsArtifact = yield* artifacts.latest(c.sourceOwner, "contact-sheet")
        const sheetsDir = Option.flatMapNullishOr(sheetsArtifact, artifacts.resolve)
        const sheetSet = Option.flatMap(sheetsArtifact, (a) => Schema.decodeUnknownOption(ContactSheetSet)(a.data))
        const sheets = Option.isSome(sheetsDir) && Option.isSome(sheetSet)
          ? sheetSet.value.sheets.map((s) => `- ${path.join(sheetsDir.value, s.file)}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`)
          : []

        const projectDir = home.projectDir(c.project.id)
        const detailRoot = path.join(projectDir, "sections-detail")
        const previewRoot = path.join(projectDir, "sections-preview")
        yield* Effect.forEach([detailRoot, previewRoot], (dir) => fs.makeDirectory(dir, { recursive: true }), { discard: true }).pipe(
          Effect.mapError(failWith("write"))
        )
        const brief = buildSectionsBrief({
          creatorBrief: c.project.brief,
          title: c.source.title,
          channel: c.source.channel,
          angle: Option.match(proposal, { onNone: () => null, onSome: ({ title, hook, why }) => ({ title, hook, why }) }),
          story: Option.getOrNull(story),
          excluded: c.sectionContext.excluded,
          sourceSeconds: c.sectionContext.sourceSeconds,
          sheets,
          transcript: transcripts.timedText(c.transcript)
        })
        const draft = yield* runChecked(agent, ctx, {
          stage: "sections",
          instructions: SECTIONS_PROMPT,
          skills: ["story-arc", approachSkill(c.project.approach)],
          brief,
          output: { tool: "propose_sections", description: "Submit the whole cut-down plan.", schema: SectionsProposal },
          tools: [
            detailSheetTool(contactSheets, path, c.video, c.sectionContext.sourceSeconds, detailRoot),
            previewTool(c.video, c.sectionContext, previewRoot, ctx.attempt)
          ],
          defaultModel: null,
          readDirs: [...Option.toArray(sheetsDir), detailRoot, previewRoot],
          maxTurns: 60
        }, (proposed) => Effect.succeed(checkSections(proposed, c.sectionContext))).pipe(Effect.mapError((e) => fail(e.code, e.message)))
        yield* record(ctx, c.video, draft)
      })

      // An edit sends back the hook text and sections; they're snapped and checked again.
      const applyEdit = Effect.fn("SectionsStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const proposal = yield* Schema.decodeUnknownEffect(SectionsProposal)(edited).pipe(Effect.mapError(failWith("invalid-edit")))
        const c = yield* context(ctx)
        const checked = checkSections(proposal, c.sectionContext)
        if (checked.problems.length > 0) return yield* fail("invalid-edit", checked.problems.join("; "))
        yield* record(ctx, c.video, checked.value)
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
    Sources.layer,
    Artifacts.layer,
    Transcripts.layer,
    ContactSheets.layer,
    ScriptRunner.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
