import { NodeServices } from "@effect/platform-node"
import {
  AdRanges,
  type Artifact,
  type ArtifactOwner,
  type GatePayload,
  type ProjectId,
  Script,
  ShotPlan,
  ShotProposal,
  StoryMap,
  Transcript,
  Voiceover
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { agentTool, AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ContactSheets, ContactSheetSet } from "../contact-sheet/contact-sheets.ts"
import { detailSheetTool } from "../contact-sheet/detail-sheet-tool.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Presets } from "../presets/presets.ts"
import { Projects } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { ScriptRunner } from "../script-runner/script-runner.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { checkShots, narrationEnds, placeReals, type ShotContext, type ShotDraft } from "./shot-rules.ts"
import { buildShotsBrief, SHOTS_PROMPT } from "./shots-prompt.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "shots", code, message })
const failWith = (code: string) => (error: { readonly message: string }) => fail(code, error.message)

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the shots stage runs on a project")
  return ctx.owner.id
}

const StoryboardLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), done: Schema.Int, total: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("done"), tiles: Schema.Int })
]))
const TranscriptJson = Schema.fromJsonString(Transcript)
const StoryboardSpec = Schema.fromJsonString(Schema.Struct({
  cols: Schema.Int,
  tiles: Schema.Array(Schema.Struct({
    t: Schema.Finite,
    label: Schema.String,
    kind: Schema.Literals(["shot", "real"]),
    file: Schema.String
  }))
}))

const frameFile = (kind: "shot" | "insert" | "outro", index: number) => `frames/${kind}-${String(index + 1).padStart(2, "0")}.jpg`

// The storyboard's tiles in playing order: each shot's first frame, with the real clips where they play. Every
// tile's frame is also saved on its own (`file`).
const storyboardTiles = (plan: ShotDraft) => {
  const tiles: Array<{ t: number; label: string; kind: "shot" | "real"; file: string }> = []
  const real = (clip: { readonly start: number; readonly end: number; readonly quote: string }, file: string) =>
    tiles.push({ t: (clip.start + clip.end) / 2, label: `REAL ${clip.quote}`, kind: "real", file })
  let nextInsert = 0
  plan.shots.forEach((shot, k) => {
    while (plan.inserts[nextInsert] !== undefined && plan.inserts[nextInsert]!.afterWord < shot.word) {
      real(plan.inserts[nextInsert]!, frameFile("insert", nextInsert))
      nextInsert++
    }
    tiles.push({ t: shot.src + 0.2, label: `${k + 1}  w${shot.word} ${shot.wordText}`, kind: "shot", file: frameFile("shot", k) })
  })
  for (; nextInsert < plan.inserts.length; nextInsert++) real(plan.inserts[nextInsert]!, frameFile("insert", nextInsert))
  plan.outro.forEach((clip, k) => real(clip, frameFile("outro", k)))
  return tiles
}

// Plans a narrated short's b-roll: an agent with vision picks footage from the contact sheets for each part of
// the voiceover, asking for one-per-second detail sheets around each moment. The server places the real
// lines, checks the plan, and draws a storyboard for the gate.
export class ShotsStage extends Context.Service<ShotsStage, {
  readonly stage: StageDefinition
}>()("@viral/server/shots/shots-stage/ShotsStage") {
  static readonly layer = Layer.effect(
    ShotsStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const sources = yield* Sources
      const presets = yield* Presets
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
      const context = Effect.fn("ShotsStage.context")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const sourceOwner = { _tag: "Source", id: project.sourceId } as const
        const source = yield* sources.get(project.sourceId).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const video = yield* Effect.fromOption(Option.flatMapNullishOr(yield* artifacts.latest(sourceOwner, "source-video"), artifacts.resolve)).pipe(
          Effect.mapError(() => fail("not-ready", "the source video hasn't been fetched"))
        )
        const script = yield* Effect.fromOption(yield* latestData(ctx.owner, "script", Script)).pipe(
          Effect.mapError(() => fail("not-ready", "the short has no script yet"))
        )
        const voiceover = yield* Effect.fromOption(yield* latestData(ctx.owner, "voiceover", Voiceover)).pipe(
          Effect.mapError(() => fail("not-ready", "the short has no voiceover yet"))
        )
        const voFile = yield* Effect.fromOption(Option.flatMapNullishOr(yield* artifacts.latest(ctx.owner, "voiceover-transcript"), artifacts.resolve)).pipe(
          Effect.mapError(() => fail("not-ready", "the voiceover has no transcript"))
        )
        const voTranscript = yield* fs.readFileString(voFile).pipe(
          Effect.flatMap(Schema.decodeEffect(TranscriptJson)),
          Effect.mapError(failWith("not-ready"))
        )
        const words = voTranscript.segments.flatMap((s) => s.words)
        const excluded = Option.match(yield* latestData(sourceOwner, "ad-ranges", AdRanges), { onNone: () => [], onSome: (a) => a.ranges })
        const sourceSeconds = source.durationS ?? (yield* transcripts.forSource(project.sourceId).pipe(
          Effect.map((t) => t.segments.at(-1)?.end ?? 0),
          Effect.mapError(() => fail("not-ready", "the source has no transcript"))
        ))
        const reals = placeReals(script, words)
        const shotContext: ShotContext = { words, voiceoverSeconds: voiceover.durationS, sourceSeconds, excluded, inserts: reals.inserts }
        return { project, source, video, script, words, excluded, sourceSeconds, reals, shotContext }
      })

      // Draws the plan's frames and storyboard, and records it.
      // Draws a plan's frames (frames/shot-NN.jpg…) and their storyboard into `dir`. Returns the storyboard's
      // file name, or null when it couldn't be drawn.
      const draw = Effect.fn("ShotsStage.draw")(function*(video: string, plan: ShotDraft, dir: string) {
        const spec = path.join(dir, "storyboard.json")
        yield* Schema.encodeEffect(StoryboardSpec)({ cols: 6, tiles: storyboardTiles(plan) }).pipe(
          Effect.flatMap((json) => fs.writeFileString(spec, json)),
          Effect.mapError(failWith("write"))
        )
        return yield* scripts.run(
          [path.join(import.meta.dirname, "storyboard.py"), video, spec, path.join(dir, "storyboard.png")],
          Schema.decodeEffect(StoryboardLine),
          (line) => Effect.succeed(line.type === "done" ? "storyboard.png" : undefined)
        ).pipe(
          Effect.tapError((error) => Effect.logWarning("no storyboard", { error: error.message })),
          Effect.orElseSucceed(() => null)
        )
      })

      // The agent's self-check: the plan's problems, or its frames drawn so it can see each shot before
      // submitting. Every preview gets its own folder so earlier ones stay readable.
      const previewTool = (video: string, shotContext: ShotContext, reals: Pick<ShotDraft, "inserts" | "outro">, root: string, attempt: number) => {
        let drawn = 0
        return agentTool({
          name: "preview_shots",
          description: "Check a shot plan and draw each shot's first frame. Returns the problems to fix, or the storyboard and frame files to Read.",
          schema: ShotProposal,
          run: Effect.fn("ShotsStage.preview")(function*(proposal: ShotProposal) {
              const checked = checkShots(proposal, shotContext)
              if (checked.problems.length > 0) return `Fix these first:\n${checked.problems.map((p) => `- ${p}`).join("\n")}`
              const dir = path.join(root, `attempt-${attempt}-${++drawn}`)
              yield* fs.makeDirectory(dir, { recursive: true })
              const plan: ShotDraft = { ...checked.value, ...reals }
              const storyboard = yield* draw(video, plan, dir)
              if (storyboard === null) return "The plan passes the checks, but its frames couldn't be drawn; submit it."
              const frames = plan.shots.map((shot, k) =>
                `- shot ${k + 1} (word ${shot.word} "${shot.wordText}", ${shot.src.toFixed(1)}s, ${shot.note}): ${path.join(dir, frameFile("shot", k))}`
              )
              return [
                `The plan passes the checks. Storyboard (every shot in playing order, real clips framed red): ${path.join(dir, storyboard)}`,
                `Each shot's first frame:\n${frames.join("\n")}`,
                "Read the storyboard (and any frame you're unsure of). Fix every shot whose frame doesn't show its words, then call propose_shots."
              ].join("\n\n")
            }, Effect.catch((error) => Effect.succeed(`couldn't draw the preview: ${error.message}`)))
        })
      }

      const record = Effect.fn("ShotsStage.record")(function*(ctx: StageContext, video: string, plan: ShotDraft) {
        const slot = yield* artifacts.allocate(ctx.owner, "shot-plan")
        // the storyboard is for your eyes; a plan without one is still a plan
        const storyboard = yield* draw(video, plan, slot.dir)
        // the storyboard and the frames are drawn together
        const drawn = storyboard !== null
        const shotPlan: ShotPlan = {
          shots: plan.shots.map((shot, k) => ({ ...shot, frame: drawn ? frameFile("shot", k) : null })),
          markers: plan.markers,
          highlights: plan.highlights,
          inserts: plan.inserts.map((clip, k) => ({ ...clip, frame: drawn ? frameFile("insert", k) : null })),
          outro: plan.outro.map((clip, k) => ({ ...clip, frame: drawn ? frameFile("outro", k) : null })),
          storyboard
        }
        yield* artifacts.record(slot, {
          data: shotPlan,
          path: storyboard === null ? null : path.join(slot.relDir, storyboard),
          stageRunId: ctx.stageRunId
        })
      })

      const run = Effect.fn("ShotsStage.run")(function*(ctx: StageContext) {
        const c = yield* context(ctx)
        const sourceOwner = { _tag: "Source", id: c.project.sourceId } as const
        const preset = c.project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(c.project.presetId).pipe(Effect.mapError(() => fail("not-found", "the project's preset is gone")))
        const story = yield* latestData(sourceOwner, "story-map", StoryMap)
        const transcript = yield* transcripts.forSource(c.project.sourceId).pipe(Effect.mapError(() => fail("not-ready", "no transcript")))

        const sheetsArtifact = yield* artifacts.latest(sourceOwner, "contact-sheet")
        const sheetsDir = Option.flatMapNullishOr(sheetsArtifact, artifacts.resolve)
        const sheetSet = Option.flatMap(sheetsArtifact, (a) => Schema.decodeUnknownOption(ContactSheetSet)(a.data))
        const sheets = Option.isSome(sheetsDir) && Option.isSome(sheetSet)
          ? sheetSet.value.sheets.map((s) => `- ${path.join(sheetsDir.value, s.file)}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`)
          : []

        // one-per-second sheets the agent asks for, kept with the project for later attempts
        const detailRoot = path.join(home.projectDir(c.project.id), "shots-detail")
        const detail = detailSheetTool(contactSheets, path, c.video, c.sourceSeconds, detailRoot)
        yield* fs.makeDirectory(detailRoot, { recursive: true }).pipe(Effect.mapError(failWith("write")))
        const previewRoot = path.join(home.projectDir(c.project.id), "shots-preview")
        yield* fs.makeDirectory(previewRoot, { recursive: true }).pipe(Effect.mapError(failWith("write")))
        const preview = previewTool(c.video, c.shotContext, c.reals, previewRoot, ctx.attempt)

        const brief = buildShotsBrief({
          creatorBrief: c.project.brief,
          title: c.source.title,
          approach: c.project.approach,
          framing: preset.config.framing,
          shotSeconds: preset.config.pace.shotSeconds,
          words: c.words,
          narrationEnds: narrationEnds(c.script, c.words),
          inserts: c.reals.inserts,
          outro: c.reals.outro,
          story: Option.getOrNull(story),
          excluded: c.excluded,
          sourceSeconds: c.sourceSeconds,
          sheets,
          transcript: transcripts.timedText(transcript)
        })
        const plan = yield* runChecked(agent, ctx, {
          stage: "shots",
          instructions: SHOTS_PROMPT,
          skills: ["narrated-shots"],
          brief,
          output: { tool: "propose_shots", description: "Submit the whole shot plan.", schema: ShotProposal },
          tools: [detail, preview],
          defaultModel: null,
          readDirs: [...Option.toArray(sheetsDir), detailRoot, previewRoot],
          maxTurns: 60
        }, (proposed) => Effect.succeed(checkShots(proposed, c.shotContext))).pipe(Effect.mapError((e) => fail(e.code, e.message)))
        yield* record(ctx, c.video, { ...plan, ...c.reals })
      })

      // An edit sends back the shots and markers; the real lines are placed again from the script.
      const applyEdit = Effect.fn("ShotsStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const proposal = yield* Schema.decodeUnknownEffect(ShotProposal)(edited).pipe(Effect.mapError(failWith("invalid-edit")))
        const c = yield* context(ctx)
        const checked = checkShots(proposal, c.shotContext)
        if (checked.problems.length > 0) return yield* fail("invalid-edit", checked.problems.join("; "))
        yield* record(ctx, c.video, { ...checked.value, ...c.reals })
      })

      const stage: StageDefinition = {
        name: "shots",
        artifact: "shot-plan",
        gate: "Approve the shots?",
        run,
        applyEdit,
        gatePayload: (artifact: Artifact): GatePayload =>
          Option.match(Schema.decodeUnknownOption(ShotPlan)(artifact.data), {
            onNone: () => ({ _tag: "ArtifactGate", artifact }),
            onSome: (plan) => ({ _tag: "ShotsGate", plan, storyboard: artifacts.resolve(artifact) })
          })
      }
      return ShotsStage.of({ stage })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    Sources.layer,
    Presets.layer,
    Artifacts.layer,
    Transcripts.layer,
    ContactSheets.layer,
    ScriptRunner.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
