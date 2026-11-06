import { AdRanges, ContactSheetSet, type SourceId, type SourceNotFound, type SourceOverview, StoryMap } from "@viral/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { RunStore } from "../runs/run-store.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { Sources } from "./sources.ts"
import { matchProposals, transcriptLines } from "./source-overview-values.ts"

// A video's page in one call: the video, its latest source run with its stages, the story and proposals, the
// ad ranges, the contact sheets, the transcript, and the shorts made from it.
export class SourceOverviews extends Context.Service<SourceOverviews, {
  get(sourceId: SourceId): Effect.Effect<SourceOverview, SourceNotFound>
}>()("@viral/server/sources/source-overview/SourceOverviews") {
  static readonly layer = Layer.effect(
    SourceOverviews,
    Effect.gen(function*() {
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const store = yield* RunStore
      const projects = yield* Projects
      const transcripts = yield* Transcripts

      const get = Effect.fn("SourceOverviews.get")(function*(sourceId: SourceId) {
        const source = yield* sources.get(sourceId)
        const owner = { _tag: "Source", id: sourceId } as const
        const runs = yield* store.listRuns(owner)
        const run = [...runs].sort((a, b) => b.startedAt.epochMilliseconds - a.startedAt.epochMilliseconds)[0] ?? null
        const stages = run === null ? [] : yield* store.listStageRuns(run.id)
        const dataOf = <A, I>(kind: "story-map" | "ad-ranges" | "contact-sheet", schema: Schema.Codec<A, I>) =>
          Effect.map(artifacts.latest(owner, kind), (artifact) =>
            Option.flatMap(artifact, (a) => Option.map(Schema.decodeUnknownOption(schema)(a.data), (data) => ({ version: a.version, data }))))
        const story = Option.map(yield* dataOf("story-map", StoryMap), (s) => s.data)
        const ads = Option.match(yield* dataOf("ad-ranges", AdRanges), { onNone: () => [], onSome: (a) => a.data.ranges })
        const sheets = yield* dataOf("contact-sheet", ContactSheetSet)
        const transcript = yield* transcripts.forSource(sourceId).pipe(Effect.option)
        const made = yield* projects.list(sourceId)
        return {
          source,
          run,
          stages,
          story: Option.getOrNull(story),
          ads,
          contactSheet: Option.getOrNull(Option.map(sheets, (s) => ({ version: s.version, set: s.data }))),
          transcript: Option.getOrNull(Option.map(transcript, (t) => ({ provider: t.provider ?? null, ...transcriptLines(t) }))),
          shorts: matchProposals(made, Option.match(story, { onNone: () => [], onSome: (s) => s.proposals }))
        } satisfies SourceOverview
      })

      return SourceOverviews.of({ get })
    })
  ).pipe(Layer.provide([Sources.layer, Artifacts.layer, RunStore.layer, Projects.layer, Transcripts.layer]))
}
