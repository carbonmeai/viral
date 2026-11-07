import { cn } from "@viral/ui/cn"
import { videoColor, videoLabel } from "./set-values.ts"

// "V2" in the video's own colour: on set proposals and videos now, on every clip of a multi-video short later.
export function VideoBadge({ index, className }: { readonly index: number; readonly className?: string }) {
  const color = videoColor(index)
  return (
    <span
      className={cn("inline-flex h-[18px] min-w-[26px] shrink-0 items-center justify-center rounded-[5px] px-1 text-2xs font-semibold tabular-nums", className)}
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {videoLabel(index)}
    </span>
  )
}
