import { VideoBadge } from "../sets/video-badge.tsx"

// A clip's video ("V2" in its colour) in a short from several videos; nothing in a single-video short, so those look
// as they always did.
export function ClipBadge({ source, videos, className }: {
  // the clip's video, by position (absent = V1)
  readonly source: number | undefined
  // how many videos the short has
  readonly videos: number
  readonly className?: string
}) {
  if (videos < 2) return null
  return <VideoBadge index={source ?? 0} {...(className === undefined ? {} : { className })} />
}
