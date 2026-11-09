import { NodeServices } from "@effect/platform-node"
import { type ArtifactOwner, looksLikeRanking, type SourceSetId, StoryMap } from "@viral/contracts"
import { Context, Effect, Layer, Option, Path, Schema } from "effect"
import { ContactSheetSet } from "../contact-sheet/contact-sheets.ts"
import { AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { checkSetStory } from "./set-story-rules.ts"
import { setStoryTask } from "./set-story-task.ts"
import { transcriptTools } from "./transcript-tools.ts"

const setOf = (ctx: StageContext): SourceSetId => {
  if (ctx.owner._tag !== "Set") throw new Error("the set-story stage runs on a video set")
  return ctx.owner.id
}

// Maps the story across a video set's videos and proposes three shorts that use them together. It runs once each
// video has been read (transcript, contact sheets, ads); each proposal you pick becomes its own short.
export class SetStoryStage extends Context.Service<SetStoryStage, {
  readonly stage: StageDefinition
}>()("@viral/server/set-story/set-story-stage/SetStoryStage") {
  static readonly layer = Layer.effect(
    SetStoryStage,
    Effect.gen(function*() {
      const sets = yield* VideoSets
      const projectSources = yield* ProjectSources
      const artifacts = yield* Artifacts
      const agent = yield* AgentSession
      const path = yield* Path.Path
      const fail = (code: string, message: string) => new StageFailure({ stage: "set-story", code, message })

      // a video's overview contact sheets, as files the agent may read, and their folder
      const sheetsOf = Effect.fn("SetStoryStage.sheetsOf")(function*(owner: ArtifactOwner) {
        const artifact = yield* artifacts.latest(owner, "contact-sheet")
        const dir = Option.flatMapNullishOr(artifact, artifacts.resolve)
        const set = Option.flatMap(artifact, (a) => Schema.decodeUnknownOption(ContactSheetSet)(a.data))
        if (Option.isNone(dir) || Option.isNone(set)) return { dir: null, sheets: [] }
        return {
          dir: dir.value,
          sheets: set.value.sheets.map((s) => ({ file: path.join(dir.value, s.file), start: s.start, end: s.end }))
        }
      })

      const run = Effect.fn("SetStoryStage.run")(function*(ctx: StageContext) {
        const id = setOf(ctx)
        const set = yield* sets.get(id).pipe(Effect.mapError(() => fail("not-found", `no video set ${id}`)))
        const members = yield* projectSources.ofSources(set.sourceIds).pipe(
          Effect.mapError((e) => fail("not-found", `a video in the set is gone (${e.id})`))
        )
        const missing = members.filter((m) => Option.isNone(m.transcript)).map((m) => `Video ${m.index + 1}`)
        if (missing.length > 0) return yield* fail("not-ready", `${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no transcript yet`)

        const videos = yield* Effect.forEach(members, (member) =>
          Effect.gen(function*() {
            const sheets = yield* sheetsOf(member.owner)
            const story = Option.flatMap(yield* artifacts.latest(member.owner, "story-map"), (a) => Schema.decodeUnknownOption(StoryMap)(a.data))
            return {
              title: member.source.title,
              channel: member.source.channel,
              seconds: member.seconds,
              transcript: Option.getOrNull(member.transcript),
              excluded: member.ads,
              sheets: sheets.sheets,
              sheetsDir: sheets.dir,
              storySummary: Option.match(story, { onNone: () => null, onSome: (s) => s.summary })
            }
          }))

        // a set found from a ranking idea ("top 10…") gets a ranking among its proposals
        const ranking = set.research !== null && looksLikeRanking(set.research.idea) && members.length >= 2
        const story = yield* runChecked(agent, ctx, setStoryTask({
          brief: set.brief,
          fromIdea: set.research !== null,
          ranking,
          videos,
          readDirs: videos.flatMap((v) => v.sheetsDir === null ? [] : [v.sheetsDir]),
          tools: transcriptTools(videos)
        }), (proposed) => Effect.succeed(checkSetStory(proposed, members, { ranking }))).pipe(Effect.mapError((e) => fail(e.code, e.message)))

        const slot = yield* artifacts.allocate(ctx.owner, "set-story")
        yield* artifacts.record(slot, { data: story, path: null, stageRunId: ctx.stageRunId })
      })

      return SetStoryStage.of({ stage: { name: "set-story", artifact: "set-story", gate: null, run } })
    })
  ).pipe(Layer.provide([VideoSets.layer, ProjectSources.layer, Artifacts.layer, NodeServices.layer]))
}
