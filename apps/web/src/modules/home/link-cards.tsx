import { useAtomSet } from "@effect/atom-react"
import type { VideoLinkDetails } from "@viral/contracts"
import { IconButton } from "@viral/ui/primitives/button"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { Film, X } from "lucide-react"
import { useEffect, useState } from "react"
import { serverUrl } from "../../config/server-url.ts"
import { clock } from "../../lib/format.ts"
import { homeFileUrl } from "../../lib/media-url.ts"
import { videoNames } from "../sets/set-values.ts"
import { VideoBadge } from "../sets/video-badge.tsx"
import { lookupVideoLink } from "../videos/videos-api.ts"
import { fileParts, type VideoInput } from "./prompt-values.ts"

export type Lookup =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Found"; readonly details: VideoLinkDetails }
  | { readonly _tag: "Failed"; readonly message: string }

const LOOKUP_DELAY_MS = 400
const messageOf = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "Couldn't read that link."

// Each link's details, looked up once it has stayed put a moment (typing a link doesn't look up every letter).
export function useLinkLookups(urls: ReadonlyArray<string>): ReadonlyMap<string, Lookup> {
  const lookup = useAtomSet(lookupVideoLink, { mode: "promise" })
  const [found, setFound] = useState<ReadonlyMap<string, Lookup>>(new Map())
  const key = urls.join("\n")
  useEffect(() => {
    const missing = urls.filter((url) => !found.has(url))
    if (missing.length === 0) return
    const timer = setTimeout(() => {
      setFound((all) => new Map([...all, ...missing.map((url) => [url, { _tag: "Loading" }] as const)]))
      // one at a time: a mutation answers only its latest call, and the server asks YouTube one at a time anyway
      void missing.reduce(
        (previous, url) =>
          previous.then(() =>
            lookup({ payload: { link: url } })
              .then((details) => setFound((all) => new Map(all).set(url, { _tag: "Found", details })))
              .catch((error: unknown) => setFound((all) => new Map(all).set(url, { _tag: "Failed", message: messageOf(error) })))
          ),
        Promise.resolve()
      )
    }, LOOKUP_DELAY_MS)
    return () => clearTimeout(timer)
    // keyed by the links themselves: `found` changing must not look them up again
  }, [key])
  return found
}

// The name a video goes by in the box: its looked-up title, else the file's name.
export const titleOf = (video: VideoInput, lookups: ReadonlyMap<string, Lookup>) => {
  if (video._tag === "File") return fileParts(video.path).name
  const lookup = lookups.get(video.url)
  return lookup?._tag === "Found" ? lookup.details.title : null
}

// One card per video the box will start from: its picture, colour dot and short name, title, and channel and
// length (a file: its folder). A link that couldn't be read says why; it may still download when you start.
export function LinkCards({ videos, lookups, onRemove }: {
  readonly videos: ReadonlyArray<VideoInput>
  readonly lookups: ReadonlyMap<string, Lookup>
  readonly onRemove: (video: VideoInput) => void
}) {
  const names = videoNames(videos.map((v) => titleOf(v, lookups)))
  return (
    <div className="grid gap-1.5">
      {videos.map((video, i) => {
        const key = video._tag === "Url" ? video.url : video.path
        const lookup = video._tag === "Url" ? lookups.get(video.url) ?? { _tag: "Loading" } : null
        const details = lookup?._tag === "Found" ? lookup.details : null
        const file = video._tag === "File" ? fileParts(video.path) : null
        const thumb = details?.thumbnail === null || details === null ? null : homeFileUrl(serverUrl, details.thumbnail)
        return (
          <div key={key} className="flex min-w-0 items-center gap-2.5 rounded-[10px] bg-panel py-1.5 pr-1.5 pl-2">
            <div className="grid aspect-video w-16 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-ctl-active text-fg-3">
              {thumb !== null
                ? <img src={thumb} alt="" className="size-full object-cover" />
                : lookup?._tag === "Loading" ? <Skeleton className="size-full rounded-none" /> : <Film className="size-3.5" />}
            </div>
            <VideoBadge index={i} name={names[i]} />
            <div className="grid min-w-0 flex-1 gap-0.5">
              {lookup?._tag === "Loading"
                ? <><Skeleton className="h-3 w-[55%]" /><Skeleton className="h-2.5 w-[30%]" /></>
                : (
                  <>
                    <span className="truncate font-medium" title={details?.title ?? key}>{details?.title ?? file?.name ?? key}</span>
                    <span className="truncate text-xs text-fg-2">
                      {lookup?._tag === "Failed"
                        ? lookup.message
                        : details !== null
                        ? [details.channel, details.durationS === null ? null : clock(details.durationS), details.live ? "live stream" : null]
                          .filter((p) => p !== null).join(" · ") || "A video"
                        : file?.folder ?? ""}
                    </span>
                  </>
                )}
            </div>
            <IconButton label="Remove" onClick={() => onRemove(video)}><X /></IconButton>
          </div>
        )
      })}
    </div>
  )
}
