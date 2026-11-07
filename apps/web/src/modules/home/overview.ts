import {
  type Artifact,
  type ArtifactKind,
  ContactSheetSet,
  type Project,
  RenderedShort,
  type Run,
  ShotPlan,
  type Source,
  type WaitingItem
} from "@viral/contracts"
import { Effect, Option, Schema } from "effect"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"
import { serverUrl } from "../../config/server-url.ts"
import { artifactFileUrl } from "../../lib/media-url.ts"
import { shortStatus, type StatusView, videoStatus } from "./home-values.ts"

export interface VideoSummary {
  readonly source: Source
  readonly status: StatusView
  readonly thumb: string | null
  readonly shortCount: number
}

export interface ShortSummary {
  readonly project: Project
  readonly sourceTitle: string | null
  readonly status: StatusView
  readonly thumb: string | null
  readonly durationS: number | null
}

// What the shell and Home show: every video and short with its state and a thumbnail, and what's waiting.
export interface Overview {
  readonly videos: ReadonlyArray<VideoSummary>
  readonly shorts: ReadonlyArray<ShortSummary>
  readonly waiting: ReadonlyArray<WaitingItem>
}

// ListArtifacts is newest first within each kind, so the first of a kind is its latest version.
const latest = (artifacts: ReadonlyArray<Artifact>, kind: ArtifactKind) => Option.fromNullishOr(artifacts.find((a) => a.kind === kind))
const decoded = <A, I>(artifact: Option.Option<Artifact>, schema: Schema.Codec<A, I>) =>
  Option.flatMap(artifact, (a) => Schema.decodeUnknownOption(schema)(a.data))
const newest = (runs: ReadonlyArray<Run>): Run | undefined =>
  [...runs].sort((a, b) => b.startedAt.epochMilliseconds - a.startedAt.epochMilliseconds)[0]

const load = Effect.gen(function*() {
  const client = yield* ViralClient
  const [sources, projects, waiting] = yield* Effect.all(
    [client("ListSources", undefined), client("ListProjects", { sourceId: null }), client("ListWaiting", undefined)],
    { concurrency: "unbounded" }
  )

  const shorts = yield* Effect.forEach(projects, (project) =>
    Effect.gen(function*() {
      const owner = { _tag: "Project", id: project.id } as const
      const [runs, artifacts] = yield* Effect.all([client("ListRuns", { owner }), client("ListArtifacts", { owner })], { concurrency: 2 })
      const shotPlan = latest(artifacts, "shot-plan")
      const frame = Option.flatMapNullishOr(decoded(shotPlan, ShotPlan), (plan) => plan.shots[0]?.frame)
      const thumb = Option.isSome(frame) && Option.isSome(shotPlan)
        ? artifactFileUrl(serverUrl, owner, "shot-plan", shotPlan.value.version, frame.value)
        : null
      return {
        project,
        // a short is listed under its first video (V1)
        sourceTitle: sources.find((s) => s.id === project.sourceIds[0])?.title ?? null,
        status: shortStatus(newest(runs), waiting.find((w) => w.projectId === project.id)),
        thumb,
        durationS: Option.getOrNull(Option.map(decoded(latest(artifacts, "render"), RenderedShort), (r) => r.durationS))
      } satisfies ShortSummary
    }), { concurrency: 4 })

  const videos = yield* Effect.forEach(sources, (source) =>
    Effect.gen(function*() {
      const owner = { _tag: "Source", id: source.id } as const
      const [runs, artifacts] = yield* Effect.all([client("ListRuns", { owner }), client("ListArtifacts", { owner })], { concurrency: 2 })
      const sheetArtifact = latest(artifacts, "contact-sheet")
      // a frame from the middle of the video, else the first short's thumbnail
      const still = Option.flatMapNullishOr(decoded(sheetArtifact, ContactSheetSet), (set) => set.stills?.[Math.floor((set.stills.length - 1) * 0.6)])
      const fromSheet = Option.isSome(still) && Option.isSome(sheetArtifact)
        ? artifactFileUrl(serverUrl, owner, "contact-sheet", sheetArtifact.value.version, still.value.file)
        : null
      const own = shorts.filter((s) => s.project.sourceIds.includes(source.id))
      return {
        source,
        status: videoStatus(newest(runs), Option.isSome(latest(artifacts, "story-map"))),
        thumb: fromSheet ?? own.find((s) => s.thumb !== null)?.thumb ?? null,
        shortCount: own.length
      } satisfies VideoSummary
    }), { concurrency: 4 })

  return { videos, shorts, waiting } satisfies Overview
})

// Kept alive so the sidebar and Home share one copy; the shell refreshes it every few seconds.
export const overviewAtom = ViralClient.runtime.atom(load).pipe(Atom.keepAlive)
