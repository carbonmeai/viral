import { NodeServices } from "@effect/platform-node"
import {
  MAX_RESEARCH_VIDEO_SECONDS,
  ResearchLookupFailed,
  Shortlist,
  type ShortlistVideo,
  type Source,
  type SourceId,
  type SourceSetId,
  type StageRunId,
  type VideoSet,
  VideoSetInvalid,
  type VideoSetNotFound,
  youTubeId,
  youTubeUrl
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Sources } from "../sources/sources.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { checkShortlistEdit } from "./shortlist-rules.ts"
import { YouTube } from "./youtube.ts"
import { clock } from "./youtube-values.ts"

// The note on a video a research added to your library: footage that isn't yours, rights not confirmed.
export const researchNote = (idea: string) => `Found on YouTube for the idea “${idea.trim()}”. The footage belongs to its channel.`

// What "Replace this video" does next: the set's run from here (null = the first stage without approved work).
export type ReplaceResult = { readonly from: "research" | "set-story" | null }

// The YouTube id of a library video, from its link.
const videoIdOf = (source: Source) =>
  youTubeId(source.url ?? "") ?? (source.origin._tag === "Url" ? youTubeId(source.origin.url) : null)

// Research sets' shared work outside the agent: saving thumbnails, looking up a link you add, checking your edited
// list, turning an approved shortlist into the set's videos (reusing videos already in the library), and replacing
// one video with a backup or a new search.
export class Researches extends Context.Service<Researches, {
  // the shortlist's latest version, if the set has one
  latest(setId: SourceSetId): Effect.Effect<Option.Option<Shortlist>>
  // saves each video's thumbnail in the set's folder (once) and fills in its path
  withThumbnails(setId: SourceSetId, list: Shortlist): Effect.Effect<Shortlist>
  lookup(setId: SourceSetId, link: string): Effect.Effect<ShortlistVideo, ResearchLookupFailed | VideoSetNotFound>
  checkEdit(setId: SourceSetId, list: Shortlist): Effect.Effect<ReadonlyArray<string>, VideoSetNotFound>
  // the approved list becomes the set's videos, in order; videos the set no longer uses that a research added are
  // deleted. Records the list again with each video's library id.
  adopt(setId: SourceSetId, list: Shortlist, stageRunId: StageRunId | null): Effect.Effect<Shortlist, VideoSetInvalid | VideoSetNotFound>
  replace(setId: SourceSetId, sourceId: SourceId, backup: string | null, reason: string): Effect.Effect<ReplaceResult, VideoSetInvalid | VideoSetNotFound>
}>()("@viral/server/research/researches") {
  static readonly layer = Layer.effect(
    Researches,
    Effect.gen(function*() {
      const sets = yield* VideoSets
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const youtube = yield* YouTube
      const home = yield* ViralHome
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const ownerOf = (setId: SourceSetId) => ({ _tag: "Set", id: setId }) as const
      const researchSet = Effect.fn("Researches.researchSet")(function*(setId: SourceSetId) {
        const set = yield* sets.get(setId)
        if (set.research === null) return yield* new VideoSetInvalid({ message: "this set wasn't found from an idea" })
        return set as VideoSet & { readonly research: NonNullable<VideoSet["research"]> }
      })

      const latest = Effect.fn("Researches.latest")(function*(setId: SourceSetId) {
        const artifact = yield* artifacts.latest(ownerOf(setId), "shortlist")
        return Option.flatMap(artifact, (a) => Schema.decodeUnknownOption(Shortlist)(a.data))
      })

      const record = Effect.fn("Researches.record")(function*(setId: SourceSetId, list: Shortlist, stageRunId: StageRunId | null) {
        const slot = yield* artifacts.allocate(ownerOf(setId), "shortlist")
        yield* artifacts.record(slot, { data: list, path: null, ...(stageRunId === null ? {} : { stageRunId }) })
      })

      const thumbnailOf = Effect.fn("Researches.thumbnailOf")(function*(setId: SourceSetId, videoId: string) {
        const rel = path.join("sets", setId, "research", "thumbs", `${videoId}.jpg`)
        const file = path.join(home.root, rel)
        if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) return rel
        return (yield* youtube.saveThumbnail(videoId, file)) ? rel : null
      })

      const withThumbnails = Effect.fn("Researches.withThumbnails")(function*(setId: SourceSetId, list: Shortlist) {
        const fill = (v: ShortlistVideo) =>
          v.thumbnail !== null ? Effect.succeed(v) : Effect.map(thumbnailOf(setId, v.videoId), (thumbnail) => ({ ...v, thumbnail }))
        return {
          ...list,
          picks: yield* Effect.forEach(list.picks, fill),
          backups: yield* Effect.forEach(list.backups, fill)
        }
      })

      const lookup = Effect.fn("Researches.lookup")(function*(setId: SourceSetId, link: string) {
        yield* sets.get(setId)
        const id = youTubeId(link)
        if (id === null) return yield* new ResearchLookupFailed({ message: "That isn't a YouTube video link." })
        const details = yield* youtube.details(id, { captions: false }).pipe(
          Effect.mapError((e) =>
            new ResearchLookupFailed({
              message: e.kind === "blocked"
                ? "YouTube refused the lookup. Try again later; Viral doesn't work around it."
                : e.kind === "unavailable"
                ? `That video can't be used: ${e.message}.`
                : `Couldn't look it up: ${e.message}.`
            })
          )
        )
        if (details.live === true) return yield* new ResearchLookupFailed({ message: "That's a live stream; add a recorded video." })
        if (details.durationS !== null && details.durationS > MAX_RESEARCH_VIDEO_SECONDS) {
          return yield* new ResearchLookupFailed({ message: `That video is ${clock(details.durationS)} long; videos can be up to ${MAX_RESEARCH_VIDEO_SECONDS / 60} minutes.` })
        }
        return {
          videoId: id,
          url: youTubeUrl(id),
          title: details.title,
          channel: details.channel,
          durationS: details.durationS,
          views: details.views,
          uploadDate: details.uploadDate,
          thumbnail: yield* thumbnailOf(setId, id),
          part: "Added by you",
          why: "You added this link.",
          moments: [],
          addedBy: "you",
          sourceId: null
        } satisfies ShortlistVideo
      })

      const checkEdit = Effect.fn("Researches.checkEdit")(function*(setId: SourceSetId, list: Shortlist) {
        yield* sets.get(setId)
        return checkShortlistEdit(list)
      })

      const adopt = Effect.fn("Researches.adopt")(function*(setId: SourceSetId, list: Shortlist, stageRunId: StageRunId | null) {
        const set = yield* researchSet(setId)
        const problems = checkShortlistEdit(list)
        if (problems.length > 0) return yield* new VideoSetInvalid({ message: problems.join(" ") })
        const library = yield* sources.list
        const note = researchNote(set.research.idea)
        const picks = yield* Effect.forEach(list.picks, (pick) =>
          Effect.gen(function*() {
            const own = pick.sourceId === null ? undefined : library.find((s) => s.id === pick.sourceId)
            const reused = own ?? library.find((s) => videoIdOf(s) === pick.videoId)
            if (reused !== undefined) return { ...pick, sourceId: reused.id }
            // read from a 480p scan; a short fetches the seconds it uses in 1080p
            const made = yield* sources.create({ origin: { _tag: "Url", url: youTubeUrl(pick.videoId), scan: true }, rights: "unconfirmed", rightsNote: note })
            yield* sources.setDetails(made.id, pick.title, pick.channel).pipe(Effect.orDie)
            return { ...pick, sourceId: made.id }
          }))
        const ids = picks.map((p) => p.sourceId as SourceId)
        yield* sets.setVideos(setId, ids)
        // a video this research added that the set no longer uses goes (one in another set or short stays)
        const dropped = set.sourceIds.filter((id) => !ids.includes(id))
        yield* Effect.forEach(dropped, (id) =>
          Effect.gen(function*() {
            const source = library.find((s) => s.id === id)
            if (source?.rightsNote !== note) return
            yield* sources.remove(id).pipe(Effect.ignore)
          }), { discard: true })
        const adopted: Shortlist = { ...list, picks, replacing: null }
        yield* record(setId, adopted, stageRunId)
        return adopted
      })

      const replace = Effect.fn("Researches.replace")(function*(setId: SourceSetId, sourceId: SourceId, backup: string | null, reason: string) {
        const set = yield* researchSet(setId)
        const list = Option.getOrNull(yield* latest(setId))
        const spot = list?.picks.findIndex((p) => p.sourceId === sourceId) ?? -1
        if (list === null || spot < 0 || !set.sourceIds.includes(sourceId)) {
          return yield* new VideoSetInvalid({ message: "that video isn't one of this set's videos" })
        }
        const old = list.picks[spot]!
        const story = yield* artifacts.latest(ownerOf(setId), "set-story")
        if (backup === null) {
          // the research searches again for this spot, and its list waits for you
          yield* record(setId, { ...list, replacing: { videoId: old.videoId, reason: reason.trim() || "find a better video for this spot" } }, null)
          return { from: "research" } satisfies ReplaceResult
        }
        const chosen = list.backups.find((b) => b.videoId === backup || b.videoId === youTubeId(backup))
        if (chosen === undefined) return yield* new VideoSetInvalid({ message: "that backup isn't on the shortlist" })
        const picks = list.picks.map((p, i) => i === spot ? { ...chosen, sourceId: null } : p)
        yield* adopt(setId, { ...list, picks, backups: list.backups.filter((b) => b.videoId !== chosen.videoId) }, null)
        // the new video is read, then the story across the videos is made again
        return { from: Option.isSome(story) ? "set-story" : null } satisfies ReplaceResult
      })

      return Researches.of({ latest, withThumbnails, lookup, checkEdit, adopt, replace })
    })
  ).pipe(Layer.provide([VideoSets.layer, Sources.layer, Artifacts.layer, YouTube.layer, ViralHome.layer, NodeServices.layer]))
}
