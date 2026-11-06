import type * as React from "react"
import { cn } from "../cn.ts"

export interface ThumbProps {
  readonly src: string | null
  // a long video's frame (16:9) or a short's (9:16)
  readonly shape: "wide" | "tall"
  // width in px; the height follows the shape
  readonly width: number
  readonly fallback?: React.ReactNode
  readonly className?: string
}

// A small frame from a video, or a quiet placeholder when there isn't one yet.
export function Thumb({ src, shape, width, fallback, className }: ThumbProps) {
  return (
    <div
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded-[6px] bg-ctl-active text-fg-3", className)}
      style={{ width, aspectRatio: shape === "wide" ? "16 / 9" : "9 / 16" }}
    >
      {src === null ? fallback : <img src={src} alt="" className="size-full object-cover" loading="lazy" />}
    </div>
  )
}
