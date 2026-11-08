import { VideoBadge } from "../sets/video-badge.tsx"
import { nameOf, useShortVideos } from "./short-videos.tsx"

// A clip's video (its colour dot and short name) in a short from several videos; nothing in a single-video short, so
// those look as they always did.
export function ClipBadge({ source, videos, className }: {
  // the clip's video, by position (absent = the first)
  readonly source: number | undefined
  // how many videos the short has
  readonly videos: number
  readonly className?: string
}) {
  const named = useShortVideos()
  if (videos < 2) return null
  const index = source ?? 0
  return <VideoBadge index={index} name={nameOf(named, index)} title={named.titles[index]} {...(className === undefined ? {} : { className })} />
}
