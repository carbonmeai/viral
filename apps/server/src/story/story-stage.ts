import { NodeServices } from "@effect/platform-node"
import { AdRanges, type SourceId } from "@viral/contracts"
import { Context, Effect, Layer, Option, Path, Schema } from "effect"
import { ContactSheetSet } from "../contact-sheet/contact-sheets.ts"
import { AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { checkStory } from "./story-rules.ts"
import { storyTask } from "./story-task.ts"


const sourceOf = (ctx: StageContext): SourceId => {
  if (ctx.owner._tag !== "Source") throw new Error("the story stage runs on a source")
  return ctx.owner.id
}

// Maps the long video's story and proposes three shorts from it, one per approach. Each proposal you pick
// becomes its own short.
export class StoryStage extends Context.Service<StoryStage, {
  readonly stage: StageDefinition
}>()("@viral/server/story/story-stage/StoryStage") {
  static readonly layer = Layer.effect(
    StoryStage,
    Effect.gen(function*() {
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const transcripts = yield* Transcripts
      const agent = yield* AgentSession
      const path = yield* Path.Path
      const fail = (code: string, message: string) => new StageFailure({ stage: "story", code, message })

      const run = Effect.fn("StoryStage.run")(function*(ctx: StageContext) {
        const id = sourceOf(ctx)
        const owner = { _tag: "Source", id } as const
        const source = yield* sources.get(id).pipe(Effect.mapError(() => fail("not-found", `no source ${id}`)))
        const transcript = yield* transcripts.forSource(id).pipe(Effect.mapError(() => fail("not-ready", "no transcript yet")))
        const ads = Option.flatMap(yield* artifacts.latest(owner, "ad-ranges"), (a) => Schema.decodeUnknownOption(AdRanges)(a.data))
        const excluded = Option.match(ads, { onNone: () => [], onSome: (a) => a.ranges })

        // the contact sheets, as files the agent may read
        const sheetsArtifact = yield* artifacts.latest(owner, "contact-sheet")
        const sheetsDir = Option.flatMapNullishOr(sheetsArtifact, artifacts.resolve)
        const sheetSet = Option.flatMap(sheetsArtifact, (a) => Schema.decodeUnknownOption(ContactSheetSet)(a.data))
        const sheets = Option.isSome(sheetsDir) && Option.isSome(sheetSet)
          ? sheetSet.value.sheets.map((s) => ({ file: path.join(sheetsDir.value, s.file), start: s.start, end: s.end }))
          : []

        const words = transcript.segments.flatMap((s) => s.words)
        const map = yield* runChecked(agent, ctx, storyTask({
          title: source.title,
          channel: source.channel,
          excluded,
          sheets,
          sheetsDir: Option.getOrNull(sheetsDir),
          transcript: transcripts.timedText(transcript)
        }), (proposed) => Effect.succeed(checkStory(proposed, words, excluded))).pipe(Effect.mapError((e) => fail(e.code, e.message)))

        const slot = yield* artifacts.allocate(owner, "story-map")
        yield* artifacts.record(slot, { data: map, path: null, stageRunId: ctx.stageRunId })
      })

      return StoryStage.of({ stage: { name: "story", artifact: "story-map", gate: null, run } })
    })
  ).pipe(Layer.provide([Sources.layer, Artifacts.layer, Transcripts.layer, NodeServices.layer]))
}
