import { NodeServices } from "@effect/platform-node"
import { type VideoLinkDetails, VideoLinkLookupFailed, youTubeId } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { ViralHome } from "../home/viral-home.ts"
import { YouTube } from "../research/youtube.ts"

// Where a pasted link's thumbnail is kept, relative to the Viral home (served under /media).
const PREVIEWS = "link-previews"
// Lookups kept in memory, so typing around a link doesn't ask YouTube again.
const CACHE_MAX = 200

const plain = (kind: "blocked" | "unavailable" | "failed", message: string) =>
  kind === "blocked"
    ? "YouTube refused the lookup. It may still download when you start; Viral doesn't work around a block."
    : kind === "unavailable"
    ? `That video can't be used: ${message}.`
    : `Couldn't read that link: ${message}.`

// What a link on Home is before anything downloads: yt-dlp's title, channel and length (no captions, no download),
// and for a YouTube link its thumbnail, saved once into link-previews/. Answers are kept per link while the server
// runs.
export class VideoLinks extends Context.Service<VideoLinks, {
  lookup(link: string): Effect.Effect<VideoLinkDetails, VideoLinkLookupFailed>
}>()("@viral/server/sources/video-links/VideoLinks") {
  static readonly make = Effect.gen(function*() {
    const youtube = yield* YouTube
    const home = yield* ViralHome
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const cache = new Map<string, VideoLinkDetails>()

    const thumbnailOf = Effect.fn("VideoLinks.thumbnailOf")(function*(videoId: string) {
      const rel = `${PREVIEWS}/${videoId}.jpg`
      const file = path.join(home.root, rel)
      if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) return rel
      return (yield* youtube.saveThumbnail(videoId, file)) ? rel : null
    })

    const lookup = Effect.fn("VideoLinks.lookup")(function*(link: string) {
      const url = link.trim()
      if (!/^https?:\/\/\S+\.\S+/.test(url)) return yield* new VideoLinkLookupFailed({ message: "That isn't a link." })
      const known = cache.get(url)
      if (known !== undefined) return known
      const id = youTubeId(url)
      const details = yield* youtube.detailsOfLink(id === null ? url : `https://www.youtube.com/watch?v=${id}`).pipe(
        Effect.mapError((e) => new VideoLinkLookupFailed({ message: plain(e.kind, e.message) }))
      )
      const result: VideoLinkDetails = {
        url,
        title: details.title,
        channel: details.channel,
        durationS: details.durationS,
        thumbnail: id === null ? null : yield* thumbnailOf(id),
        live: details.live === true
      }
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
      cache.set(url, result)
      return result
    })

    return VideoLinks.of({ lookup })
  })

  static readonly layer = Layer.effect(VideoLinks, VideoLinks.make).pipe(
    Layer.provide([YouTube.layer, ViralHome.layer, NodeServices.layer])
  )
}
