import { NodeServices } from "@effect/platform-node"
import { type AdRange, AdRanges, type Project, type Source, type SourceId, type SourceNotFound, type Transcript } from "@viral/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { sourcesOf } from "./projects.ts"
import type { SourceContext } from "./source-context.ts"

// One of a short's videos with what the stages plan from and check against.
export interface ProjectSource extends SourceContext {
  // its position in the short's videos: V1 = 0
  readonly index: number
  readonly source: Source
  readonly owner: { readonly _tag: "Source"; readonly id: SourceId }
  // the downloaded video's absolute path, once fetched
  readonly video: Option.Option<string>
  readonly transcript: Option.Option<Transcript>
  // the excluded ranges with what they are (sponsor, ad, intro…)
  readonly ads: ReadonlyArray<AdRange>
}

// Loads a short's videos, V1 first: each one's source, video file, transcript, length and excluded ranges. A
// video with no transcript yet has no words; its length is the source's, else the transcript's, else 0.
export class ProjectSources extends Context.Service<ProjectSources, {
  of(project: Project): Effect.Effect<readonly [ProjectSource, ...Array<ProjectSource>], SourceNotFound>
  // the same for any videos in order (a video set's), V1 first
  ofSources(ids: ReadonlyArray<SourceId>): Effect.Effect<ReadonlyArray<ProjectSource>, SourceNotFound>
}>()("@viral/server/projects/project-sources/ProjectSources") {
  static readonly layer = Layer.effect(
    ProjectSources,
    Effect.gen(function*() {
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const transcripts = yield* Transcripts

      const load = Effect.fn("ProjectSources.load")(function*(id: SourceId, index: number) {
        const owner = { _tag: "Source", id } as const
        const source = yield* sources.get(id)
        const video = Option.flatMapNullishOr(yield* artifacts.latest(owner, "source-video"), artifacts.resolve)
        const transcript = yield* transcripts.forSource(id).pipe(Effect.option)
        const ads = Option.flatMap(yield* artifacts.latest(owner, "ad-ranges"), (a) => Schema.decodeUnknownOption(AdRanges)(a.data))
        return {
          index,
          source,
          owner,
          video,
          transcript,
          words: Option.match(transcript, { onNone: () => [], onSome: (t) => t.segments.flatMap((s) => s.words) }),
          seconds: source.durationS ?? Option.match(transcript, { onNone: () => 0, onSome: (t) => t.segments.at(-1)?.end ?? 0 }),
          excluded: Option.match(ads, { onNone: () => [], onSome: (a) => a.ranges }),
          ads: Option.match(ads, { onNone: () => [], onSome: (a) => a.ranges })
        } satisfies ProjectSource
      })

      const of = Effect.fn("ProjectSources.of")(function*(project: Project) {
        const [first, ...rest] = sourcesOf(project)
        const v1 = yield* load(first, 0)
        const others = yield* Effect.forEach(rest, (id, i) => load(id, i + 1))
        return [v1, ...others] as const
      })

      const ofSources = (ids: ReadonlyArray<SourceId>) => Effect.forEach(ids, (id, i) => load(id, i))

      return ProjectSources.of({ of, ofSources })
    })
  ).pipe(Layer.provide([Sources.layer, Artifacts.layer, Transcripts.layer, NodeServices.layer]))
}
