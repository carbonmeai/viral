import { cn } from "@viral/ui/cn"
import { Tooltip } from "@viral/ui/primitives/tooltip"
import { videoColor, videoLabel } from "./set-values.ts"

// A video's colour as a dot: next to its full title, where a name would only repeat it.
export function VideoDot({ index, className }: { readonly index: number; readonly className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: videoColor(index) }} />
}

// Which of several videos something is from: its colour dot and short name ("Heidi Klum"), with the full title on
// hover. The same colour on the set page, New › Several videos and every step of the short.
export function VideoBadge({ index, name, title, className }: {
  readonly index: number
  // the video's short name (videoNames), else "Video 2"
  readonly name?: string | undefined
  // its full title, shown on hover when it says more than the name
  readonly title?: string | null | undefined
  readonly className?: string
}) {
  const color = videoColor(index)
  const label = name ?? videoLabel(index)
  const badge = (
    <span
      className={cn("inline-flex h-[18px] max-w-[160px] min-w-0 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-2xs font-medium tracking-normal text-fg-1 normal-case not-italic", className)}
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </span>
  )
  return title === null || title === undefined || title === label ? badge : <Tooltip content={title}>{badge}</Tooltip>
}
