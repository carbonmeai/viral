import { NodeServices } from "@effect/platform-node"
import {
  AdRanges,
  type Artifact,
  type ArtifactOwner,
  type ProjectId,
  Script,
  type ShotPlan,
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

// A detail sheet covers at most this many seconds, a frame each second.
const DETAIL_SECONDS = 60
const DetailRequest = Schema.Struct({ start: Schema.Finite, end: Schema.Finite })
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
      const record = Effect.fn("ShotsStage.record")(function*(ctx: StageContext, video: string, plan: ShotDraft) {
        const slot = yield* artifacts.allocate(ctx.owner, "shot-plan")
        const spec = path.join(slot.dir, "storyboard.json")
        yield* Schema.encodeEffect(StoryboardSpec)({ cols: 6, tiles: storyboardTiles(plan) }).pipe(
          Effect.flatMap((json) => fs.writeFileString(spec, json)),
          Effect.mapError(failWith("write"))
        )
        // the storyboard is for your eyes; a plan without one is still a plan
        const storyboard = yield* scripts.run(
          [path.join(import.meta.dirname, "storyboard.py"), video, spec, path.join(slot.dir, "storyboard.png")],
          Schema.decodeEffect(StoryboardLine),
          (line) => Effect.succeed(line.type === "done" ? "storyboard.png" : undefined)
        ).pipe(
          Effect.tapError((error) => Effect.logWarning("no storyboard", { error: error.message })),
          Effect.orElseSucceed(() => null)
        )
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
        const detail = agentTool({
          name: "contact_sheet",
          description: `A contact sheet with a frame every second between two source times (at most ${DETAIL_SECONDS}s). Returns the image files to Read.`,
          schema: DetailRequest,
          run: ({ start, end }) => {
            const from = Math.max(0, Math.floor(start))
            const to = Math.min(Math.floor(c.sourceSeconds), Math.ceil(end))
            if (!(to > from) || end - start > DETAIL_SECONDS) {
              return Effect.succeed(`ask for a range of 1–${DETAIL_SECONDS}s inside the video (0–${c.sourceSeconds.toFixed(0)}s)`)
            }
            return contactSheets.make(c.video, path.join(detailRoot, `${from}-${to}`), { every: 1, cols: 6, rows: 5, start: from, end: to }, () => Effect.void).pipe(
              Effect.map((set) => set.sheets.map((s) => `${path.join(detailRoot, `${from}-${to}`, s.file)}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`).join("\n")),
              Effect.catch((error) => Effect.succeed(`couldn't make that sheet: ${error.message}`))
            )
          }
        })
        yield* fs.makeDirectory(detailRoot, { recursive: true }).pipe(Effect.mapError(failWith("write")))

        const brief = buildShotsBrief({
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
          tools: [detail],
          defaultModel: null,
          readDirs: [...Option.toArray(sheetsDir), detailRoot],
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
        gatePayload: (artifact: Artifact) => ({ plan: artifact.data, storyboard: artifacts.resolve(artifact) })
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
