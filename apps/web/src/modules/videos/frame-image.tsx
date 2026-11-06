import { cn } from "@viral/ui/cn"
import type { FrameView } from "./video-values.ts"

// One frame of the video as an image: its own file, or its tile cut out of a contact sheet.
export function FrameImage({ frame, src, className }: { readonly frame: FrameView; readonly src: string; readonly className?: string }) {
  const base = cn("aspect-video w-full rounded-ctl bg-ctl-active", className)
  if (frame.tile === null) return <img src={src} alt="" className={cn(base, "object-cover")} loading="lazy" />
  const { col, row, cols, rows } = frame.tile
  return (
    <div
      role="img"
      aria-label=""
      className={base}
      style={{
        backgroundImage: `url("${src}")`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`
      }}
    />
  )
}
