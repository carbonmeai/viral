import { useEffect, useRef, useState } from "react"
import { clockOf } from "../editor-values.ts"

// The finished short in a 9:16 frame, playable and scrubbable (its captions are burned in). It reports where it
// is, so the timeline's playhead follows it.
export function ShortPlayer({ url, onTime }: { readonly url: string; readonly onTime?: (seconds: number | null) => void }) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [now, setNow] = useState(0)
  const [length, setLength] = useState<number | null>(null)
  useEffect(() => () => onTime?.(null), [onTime])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 place-items-center px-5 py-1.5">
        {/* sized by its frame, not the video's own 1080×1920, so it never pushes past the stage */}
        <div className="relative aspect-[9/16] h-full max-h-[540px] max-w-full overflow-hidden rounded-[10px] bg-black">
        <video
          ref={video}
          key={url}
          src={url}
          controls
          playsInline
          preload="metadata"
          aria-label="The rendered short"
          className="absolute inset-0 size-full object-contain"
          onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
          onTimeUpdate={(e) => {
            setNow(e.currentTarget.currentTime)
            onTime?.(e.currentTarget.currentTime)
          }}
          onSeeked={(e) => onTime?.(e.currentTarget.currentTime)}
        />
        </div>
      </div>
      <div className="flex shrink-0 items-center px-3.5 pt-1.5 pb-2.5 text-xs text-fg-2">
        {clockOf(now)}{length === null ? "" : ` / ${clockOf(length)}`}
      </div>
    </div>
  )
}
