import { NodeServices } from "@effect/platform-node"
import { CutPlan, type ProjectId, type PublishedShort, RenderedShort, Script, SetStory, type SourceId, StoryMap } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Presets } from "../presets/presets.ts"
import { creditedChannels } from "../projects/credits.ts"
import { Projects, sourcesOf } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Sources } from "../sources/sources.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { checkMetadata, postNotes } from "./metadata-rules.ts"
import { metadataTask } from "./metadata-task.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "metadata", code, message })

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the metadata stage runs on a project")
  return ctx.owner.id
}


// Titles and describes the approved render (Haiku), then publishes it: the mp4, srt and the post notes
// (<slug>.md) are copied into ~/.viral/renders/.
export class MetadataStage extends Context.Service<MetadataStage, {
  readonly stage: StageDefinition
}>()("@viral/server/metadata/metadata-stage/MetadataStage") {
  static readonly layer = Layer.effect(
    MetadataStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const sources = yield* Sources
      const sets = yield* VideoSets
      const presets = yield* Presets
      const artifacts = yield* Artifacts
      const agent = yield* AgentSession
      const home = yield* ViralHome
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const run = Effect.fn("MetadataStage.run")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        // every video the short draws from, V1 first
        const videos = yield* Effect.forEach(sourcesOf(project), (id) => sources.get(id)).pipe(
          Effect.mapError(() => fail("not-found", "no such source"))
        )
        const source = videos[0]!
        const several = videos.length > 1
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.mapError(() => fail("not-found", "the project's preset is gone")))
        const latest = <A, I>(kind: "script" | "cut-plan" | "render", schema: Schema.Codec<A, I>) =>
          Effect.flatMap(artifacts.latest(ctx.owner, kind), (a) =>
            Effect.fromOption(Option.flatMap(a, (x) => Schema.decodeUnknownOption(schema)(x.data))).pipe(
              Effect.mapError(() => fail("not-ready", `no ${kind} yet`))
            ))
        const render = yield* latest("render", RenderedShort)
        const storyOf = (id: SourceId) =>
          Effect.map(artifacts.latest({ _tag: "Source", id }, "story-map"), Option.flatMap((a) => Schema.decodeUnknownOption(StoryMap)(a.data)))
        const story = yield* storyOf(source.id)
        // what each video brings: the set's own line for it, else its story summary; and what joins them
        const setStory = several && project.setId !== null
          ? Option.flatMap(yield* artifacts.latest({ _tag: "Set", id: project.setId }, "set-story"), (a) => Schema.decodeUnknownOption(SetStory)(a.data))
          : Option.none()
        const set = several && project.setId !== null ? yield* sets.get(project.setId).pipe(Effect.option) : Option.none()
        const setLine = (id: SourceId) =>
          Option.flatMap(Option.all([setStory, set]), ([s, vs]) => Option.fromNullishOr(s.videos.find((v) => vs.sourceIds[v.source] === id)?.summary))
        const videoSummaries = several
          ? yield* Effect.forEach(videos, (v) =>
            Effect.map(storyOf(v.id), (own) => ({
              title: v.title,
              channel: v.channel,
              seconds: v.durationS ?? 0,
              summary: Option.getOrNull(Option.orElse(setLine(v.id), () => Option.map(own, (s) => s.summary)))
            })))
          : []

        // what the short says: the narrated script, or a cut-down short's sections in the creator's words
        const lines = project.format === "cut-down"
          ? (yield* latest("cut-plan", CutPlan)).sections.map((s) => `CREATOR (${s.beat}): "${s.text}"`).join("\n")
          : (yield* latest("script", Script)).beats.map((b) =>
            b._tag === "Narration" ? `NARRATOR: ${b.text}` : several ? `REAL (V${(b.source ?? 0) + 1}): "${b.quote}"` : `REAL: "${b.quote}"`
          ).join("\n")
        const metadata = yield* runChecked(agent, ctx, metadataTask({
          creatorBrief: project.brief,
          title: source.title,
          channel: source.channel,
          summary: Option.match(story, { onNone: () => null, onSome: (s) => s.summary }),
          approach: project.approach,
          durationS: render.durationS,
          workingTitle: project.title,
          lines,
          ...(several
            ? { videos: videoSummaries, acrossVideos: Option.getOrNull(Option.map(setStory, (s) => s.summary)) }
            : {})
        }), (proposed) => Effect.succeed(checkMetadata(proposed))).pipe(Effect.mapError((e) => fail(e.code, e.message)))

        // publish: the finished files side by side in ~/.viral/renders/
        // every channel whose footage isn't yours ("NileBlue · Mark Rober"); one video reads as before
        const credit = several
          ? creditedChannels(videos).join(" · ") || null
          : source.rights !== "owned" ? source.channel : null
        const notes = postNotes({ metadata, credit, approach: project.approach, style: preset.name, durationS: render.durationS })
        const video = path.join(home.renders, `${project.slug}.mp4`)
        const captions = path.join(home.renders, `${project.slug}.srt`)
        const notesFile = path.join(home.renders, `${project.slug}.md`)
        yield* Effect.all([
          fs.copyFile(render.video, video),
          fs.copyFile(render.captions, captions),
          fs.writeFileString(notesFile, notes)
        ], { discard: true }).pipe(Effect.mapError((e) => fail("publish", e.message)))

        const slot = yield* artifacts.allocate(ctx.owner, "metadata")
        yield* fs.writeFileString(path.join(slot.dir, `${project.slug}.md`), notes).pipe(Effect.mapError((e) => fail("write", e.message)))
        const published: PublishedShort = { ...metadata, credit, video, captions, notes: notesFile }
        yield* artifacts.record(slot, { data: published, path: path.join(slot.relDir, `${project.slug}.md`), stageRunId: ctx.stageRunId })
      })

      return MetadataStage.of({ stage: { name: "metadata", artifact: "metadata", gate: null, run } })
    })
  ).pipe(Layer.provide([Projects.layer, Sources.layer, VideoSets.layer, Presets.layer, Artifacts.layer, ViralHome.layer, NodeServices.layer]))
}
