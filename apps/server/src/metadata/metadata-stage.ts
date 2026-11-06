import { NodeServices } from "@effect/platform-node"
import { type ProjectId, type PublishedShort, RenderedShort, Script, ShortMetadata, StoryMap } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Presets } from "../presets/presets.ts"
import { Projects } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Sources } from "../sources/sources.ts"
import { checkMetadata, postNotes } from "./metadata-rules.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "metadata", code, message })

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the metadata stage runs on a project")
  return ctx.owner.id
}

const METADATA_PROMPT = `You write what a finished short is posted with, following the short-metadata skill below: a title,
two or three alternate titles, a two-sentence description and hashtags. Work only from the script and the
video details given. Call \`propose_metadata\` once.`

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
      const presets = yield* Presets
      const artifacts = yield* Artifacts
      const agent = yield* AgentSession
      const home = yield* ViralHome
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const run = Effect.fn("MetadataStage.run")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const source = yield* sources.get(project.sourceId).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.mapError(() => fail("not-found", "the project's preset is gone")))
        const latest = <A, I>(kind: "script" | "render", schema: Schema.Codec<A, I>) =>
          Effect.flatMap(artifacts.latest(ctx.owner, kind), (a) =>
            Effect.fromOption(Option.flatMap(a, (x) => Schema.decodeUnknownOption(schema)(x.data))).pipe(
              Effect.mapError(() => fail("not-ready", `no ${kind} yet`))
            ))
        const script = yield* latest("script", Script)
        const render = yield* latest("render", RenderedShort)
        const story = Option.flatMap(
          yield* artifacts.latest({ _tag: "Source", id: project.sourceId }, "story-map"),
          (a) => Schema.decodeUnknownOption(StoryMap)(a.data)
        )

        const lines = script.beats.map((b) => b._tag === "Narration" ? `NARRATOR: ${b.text}` : `REAL: "${b.quote}"`).join("\n")
        const brief = [
          `Video: ${source.title ?? "untitled"}${source.channel === null ? "" : ` (by ${source.channel})`}`,
          Option.match(story, { onNone: () => "", onSome: (s) => `What happens: ${s.summary}` }),
          `The short (${project.approach}, ${render.durationS.toFixed(0)}s), working title "${project.title}":\n${lines}`
        ].filter((part) => part !== "").join("\n\n")

        const metadata = yield* runChecked(agent, ctx, {
          stage: "metadata",
          instructions: METADATA_PROMPT,
          skills: ["short-metadata"],
          brief,
          output: { tool: "propose_metadata", description: "Submit the title, alternates, description and hashtags.", schema: ShortMetadata },
          defaultModel: "haiku",
          maxTurns: 3
        }, (proposed) => Effect.succeed(checkMetadata(proposed))).pipe(Effect.mapError((e) => fail(e.code, e.message)))

        // publish: the finished files side by side in ~/.viral/renders/
        const credit = source.rights !== "owned" ? source.channel : null
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
  ).pipe(Layer.provide([Projects.layer, Sources.layer, Presets.layer, Artifacts.layer, ViralHome.layer, NodeServices.layer]))
}
