import { NodeServices } from "@effect/platform-node"
import { AdRanges, type ArtifactKind, type ArtifactOwner, NarratedPlan, type ProjectId, Script, ShotPlan, Transcript } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { MusicLibrary } from "../music-library/music-library.ts"
import { Presets } from "../presets/presets.ts"
import { Projects } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { narrationEnds } from "../shots/shot-rules.ts"
import { Sources } from "../sources/sources.ts"
import { assembleNarrated } from "./assemble-narrated.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "assemble", code, message })

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the assemble stage runs on a project")
  return ctx.owner.id
}

const TranscriptJson = Schema.fromJsonString(Transcript)
const PlanJson = Schema.fromJsonString(NarratedPlan)

// Turns the approved shot plan into the renderer's narrated plan in the project's style (preset), with its
// music. No agent and no cost; the plan is saved as narrated.json next to its artifact.
export class AssembleStage extends Context.Service<AssembleStage, {
  readonly stage: StageDefinition
}>()("@viral/server/assemble/assemble-stage/AssembleStage") {
  static readonly layer = Layer.effect(
    AssembleStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const sources = yield* Sources
      const presets = yield* Presets
      const music = yield* MusicLibrary
      const artifacts = yield* Artifacts
      const home = yield* ViralHome
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

      const run = Effect.fn("AssembleStage.run")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const sourceOwner = { _tag: "Source", id: project.sourceId } as const
        const source = yield* sources.get(project.sourceId).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.mapError(() => fail("not-found", "the project's preset is gone")))

        const script = yield* dataOf(ctx.owner, "script", Script)
        const shots = yield* dataOf(ctx.owner, "shot-plan", ShotPlan)
        const voiceoverTranscript = yield* fileOf(ctx.owner, "voiceover-transcript")
        const words = yield* fs.readFileString(voiceoverTranscript).pipe(
          Effect.flatMap(Schema.decodeEffect(TranscriptJson)),
          Effect.map((t) => t.segments.flatMap((s) => s.words)),
          Effect.mapError((e) => fail("not-ready", e.message))
        )
        const excluded = Option.match(
          Option.flatMap(yield* artifacts.latest(sourceOwner, "ad-ranges"), (a) => Schema.decodeUnknownOption(AdRanges)(a.data)),
          { onNone: () => [], onSome: (a) => a.ranges }
        )
        const track = project.musicTrackId === null
          ? null
          : yield* music.get(project.musicTrackId).pipe(Effect.option, Effect.map(Option.getOrNull))
        // the drop lands on the first word of the last narrated line
        const ends = narrationEnds(script, words)
        const dropWord = ends.length === 0 ? null : ends.length === 1 ? 0 : ends.at(-2)! + 1

        const plan = assembleNarrated({
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
          excluded,
          credit: source.rights !== "owned" && source.channel !== null ? `Video: ${source.channel}` : null,
          music: track === null ? null : { track, file: path.join(home.music, track.path) },
          dropWord
        })
        if (track !== null && plan.music === undefined) {
          yield* ctx.progress(null, `"${track.title}" has no BPM or drop yet, so this short goes without music`)
        }

        const slot = yield* artifacts.allocate(ctx.owner, "narrated-plan")
        yield* Schema.encodeEffect(PlanJson)(plan).pipe(
          Effect.flatMap((json) => fs.writeFileString(path.join(slot.dir, "narrated.json"), json)),
          Effect.mapError((e) => fail("write", e.message))
        )
        yield* artifacts.record(slot, { data: plan, path: path.join(slot.relDir, "narrated.json"), stageRunId: ctx.stageRunId })
      })

      return AssembleStage.of({ stage: { name: "assemble", artifact: "narrated-plan", gate: null, run } })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    Sources.layer,
    Presets.layer,
    MusicLibrary.layer,
    Artifacts.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
