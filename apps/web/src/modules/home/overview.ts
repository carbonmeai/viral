import {
  type Artifact,
  type ArtifactKind,
  ContactSheetSet,
  type Project,
  RenderedShort,
  type Run,
  ShotPlan,
  type Source,
  type VideoSet,
  type WaitingItem
} from "@viral/contracts"
import { Effect, Option, Schema } from "effect"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"
import { serverUrl } from "../../config/server-url.ts"
import { artifactFileUrl, homeFileUrl } from "../../lib/media-url.ts"
import { shortStatus, type StatusView, videoStatus, videosOf } from "./home-values.ts"

export interface VideoSummary {
  readonly source: Source
  readonly status: StatusView
  readonly thumb: string | null
  readonly shortCount: number
  // its newest run (reading it), and how many shorts its story suggests (0 before it's mapped)
  readonly latestRun: Run | null
  readonly proposals: number
}

export interface ShortSummary {
  readonly project: Project
  // the video it's from ("He made the world's most extreme candy"), or every one by its short name for a short from
  // several ("Extreme candy · Heidi Klum")
  readonly sourceTitle: string | null
  readonly status: StatusView
  readonly thumb: string | null
  readonly durationS: number | null
  // its newest run: what Home's recents say it's doing, and when
  readonly latestRun: Run | null
}

// A video set on Home: its newest run, how many shorts its story suggests, and a picture per video (its videos'
// frames, or a research's shortlist thumbnails before they download).
export interface SetSummary {
  readonly set: VideoSet
  readonly latestRun: Run | null
  readonly proposals: number
  readonly thumbs: ReadonlyArray<string>
}

// What the shell and Home show: every video, video set and short with its state and a thumbnail, and what's
// waiting.
export interface Overview {
  readonly videos: ReadonlyArray<VideoSummary>
  readonly sets: ReadonlyArray<VideoSet>
  readonly setSummaries: ReadonlyArray<SetSummary>
  readonly shorts: ReadonlyArray<ShortSummary>
  readonly waiting: ReadonlyArray<WaitingItem>
}

// ListArtifacts is newest first within each kind, so the first of a kind is its latest version.
const latest = (artifacts: ReadonlyArray<Artifact>, kind: ArtifactKind) => Option.fromNullishOr(artifacts.find((a) => a.kind === kind))
const decoded = <A, I>(artifact: Option.Option<Artifact>, schema: Schema.Codec<A, I>) =>
  Option.flatMap(artifact, (a) => Schema.decodeUnknownOption(schema)(a.data))
const newest = (runs: ReadonlyArray<Run>): Run | undefined =>
  [...runs].sort((a, b) => b.startedAt.epochMilliseconds - a.startedAt.epochMilliseconds)[0]

// Read loosely: only the parts Home shows.
const Proposals = Schema.Struct({ proposals: Schema.Array(Schema.Unknown) })
const proposalCount = (artifact: Option.Option<Artifact>) => Option.getOrElse(Option.map(decoded(artifact, Proposals), (s) => s.proposals.length), () => 0)
const CutFrames = Schema.Struct({ sections: Schema.Array(Schema.Struct({ frame: Schema.NullOr(Schema.String) })) })
const RankingFrames = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ shots: Schema.Array(Schema.Struct({ firstFrame: Schema.NullOr(Schema.String) })) }))
})
const ShortlistThumbs = Schema.Struct({ picks: Schema.Array(Schema.Struct({ thumbnail: Schema.NullOr(Schema.String) })) })
const MOSAIC = 6

// A short's picture: its first shot's frame, else (a cut-down) its first section's, else (a ranking) its first entry's.
const shortThumb = (owner: { readonly _tag: "Project"; readonly id: string }, artifacts: ReadonlyArray<Artifact>): string | null => {
  const fileOf = (kind: ArtifactKind, pick: (data: unknown) => string | null | undefined) =>
    Option.getOrNull(Option.flatMap(latest(artifacts, kind), (a) => {
      const file = pick(a.data)
      return file === null || file === undefined ? Option.none() : Option.some(artifactFileUrl(serverUrl, owner, kind, a.version, file))
    }))
  return fileOf("shot-plan", (data) => Option.getOrNull(Schema.decodeUnknownOption(ShotPlan)(data))?.shots[0]?.frame)
    ?? fileOf("cut-plan", (data) => Option.getOrNull(Schema.decodeUnknownOption(CutFrames)(data))?.sections.find((s) => s.frame !== null)?.frame)
    ?? fileOf("ranking-plan", (data) =>
      Option.getOrNull(Schema.decodeUnknownOption(RankingFrames)(data))?.entries.flatMap((e) => e.shots).find((s) => s.firstFrame !== null)?.firstFrame)
}

const load = Effect.gen(function*() {
  const client = yield* ViralClient
  const [sources, projects, waiting, sets] = yield* Effect.all(
    [client("ListSources", undefined), client("ListProjects", { sourceId: null }), client("ListWaiting", undefined), client("ListVideoSets", undefined)],
    { concurrency: "unbounded" }
  )

  const shorts = yield* Effect.forEach(projects, (project) =>
    Effect.gen(function*() {
      const owner = { _tag: "Project", id: project.id } as const
      const [runs, artifacts] = yield* Effect.all([client("ListRuns", { owner }), client("ListArtifacts", { owner })], { concurrency: 2 })
      const run = newest(runs)
      return {
        project,
        sourceTitle: videosOf(project, sources),
        status: shortStatus(run, waiting.find((w) => w.projectId === project.id)),
        thumb: shortThumb(owner, artifacts),
        durationS: Option.getOrNull(Option.map(decoded(latest(artifacts, "render"), RenderedShort), (r) => r.durationS)),
        latestRun: run ?? null
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
      const run = newest(runs)
      const story = latest(artifacts, "story-map")
      return {
        source,
        status: videoStatus(run, Option.isSome(story)),
        thumb: fromSheet ?? own.find((s) => s.thumb !== null)?.thumb ?? null,
        shortCount: own.length,
        latestRun: run ?? null,
        proposals: proposalCount(story)
      } satisfies VideoSummary
    }), { concurrency: 4 })

  const setSummaries = yield* Effect.forEach(sets, (set) =>
    Effect.gen(function*() {
      const owner = { _tag: "Set", id: set.id } as const
      const [runs, artifacts] = yield* Effect.all([client("ListRuns", { owner }), client("ListArtifacts", { owner })], { concurrency: 2 })
      const fromVideos = set.sourceIds.flatMap((id) => {
        const thumb = videos.find((v) => v.source.id === id)?.thumb ?? null
        return thumb === null ? [] : [thumb]
      })
      const fromShortlist = Option.getOrElse(
        Option.map(decoded(latest(artifacts, "shortlist"), ShortlistThumbs), (list) =>
          list.picks.flatMap((p) => p.thumbnail === null ? [] : [homeFileUrl(serverUrl, p.thumbnail)])),
        () => []
      )
      return {
        set,
        latestRun: newest(runs) ?? null,
        proposals: proposalCount(latest(artifacts, "set-story")),
        thumbs: (fromVideos.length > 0 ? fromVideos : fromShortlist).slice(0, MOSAIC)
      } satisfies SetSummary
    }), { concurrency: 4 })

  return { videos, sets, setSummaries, shorts, waiting } satisfies Overview
})

// Kept alive so the sidebar and Home share one copy; the shell refreshes it every few seconds.
export const overviewAtom = ViralClient.runtime.atom(load).pipe(Atom.keepAlive)
