import { AdRanges, SetStory, Shortlist, type SourceSetId, type VideoSetNotFound, type VideoSetOverview } from "@viral/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { RunStore } from "../runs/run-store.ts"
import { matchProposals } from "../sources/source-overview-values.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { VideoSets } from "./video-sets.ts"

const newest = <A extends { readonly startedAt: { readonly epochMilliseconds: number } }>(runs: ReadonlyArray<A>) =>
  [...runs].sort((a, b) => b.startedAt.epochMilliseconds - a.startedAt.epochMilliseconds)[0] ?? null

// A set's page in one call: the set, each video with how far it has been read, the set run and its stages, the
// story and proposals across the videos, and the shorts made from them.
export class VideoSetOverviews extends Context.Service<VideoSetOverviews, {
  get(id: SourceSetId): Effect.Effect<VideoSetOverview, VideoSetNotFound>
}>()("@viral/server/video-sets/video-set-overview/VideoSetOverviews") {
  static readonly layer = Layer.effect(
    VideoSetOverviews,
    Effect.gen(function*() {
      const sets = yield* VideoSets
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const store = yield* RunStore
      const projects = yield* Projects
      const transcripts = yield* Transcripts

      const get = Effect.fn("VideoSetOverviews.get")(function*(id: SourceSetId) {
        const set = yield* sets.get(id)
        const owner = { _tag: "Set", id } as const
        const story = Option.flatMap(yield* artifacts.latest(owner, "set-story"), (a) => Schema.decodeUnknownOption(SetStory)(a.data))
        const shortlist = set.research === null
          ? Option.none()
          : Option.flatMap(yield* artifacts.latest(owner, "shortlist"), (a) => Schema.decodeUnknownOption(Shortlist)(a.data))
        const missingOf = (position: number) =>
          Option.match(story, { onNone: () => null, onSome: (s) => s.videos.find((v) => v.source === position)?.missing ?? null })
        const members = yield* Effect.forEach(set.sourceIds, (sourceId, position) =>
          Effect.gen(function*() {
            const owner = { _tag: "Source", id: sourceId } as const
            const source = yield* sources.get(sourceId).pipe(Effect.orDie)
            const run = newest(yield* store.listRuns(owner))
            const stages = run === null ? [] : yield* store.listStageRuns(run.id)
            const transcript = yield* transcripts.forSource(sourceId).pipe(Effect.option)
            const sheets = yield* artifacts.latest(owner, "contact-sheet")
            const ads = Option.flatMap(yield* artifacts.latest(owner, "ad-ranges"), (a) => Schema.decodeUnknownOption(AdRanges)(a.data))
            return {
              position,
              source,
              run,
              stages,
              ready: Option.isSome(transcript) && Option.isSome(sheets) && Option.isSome(ads),
              words: Option.getOrNull(Option.map(transcript, (t) => t.segments.reduce((n, s) => n + s.words.length, 0))),
              ads: Option.match(ads, { onNone: () => [], onSome: (a) => a.ranges }),
              missing: missingOf(position)
            }
          }))
        const run = newest(yield* store.listRuns(owner))
        const stages = run === null ? [] : yield* store.listStageRuns(run.id)
        const made = (yield* projects.list(null)).filter((p) => p.setId === id)
        return {
          set,
          members,
          run,
          stages,
          story: Option.getOrNull(story),
          shorts: matchProposals(made, Option.match(story, { onNone: () => [], onSome: (s) => s.proposals })),
          shortlist: Option.getOrNull(shortlist)
        } satisfies VideoSetOverview
      })

      return VideoSetOverviews.of({ get })
    })
  ).pipe(Layer.provide([VideoSets.layer, Sources.layer, Artifacts.layer, RunStore.layer, Projects.layer, Transcripts.layer]))
}
