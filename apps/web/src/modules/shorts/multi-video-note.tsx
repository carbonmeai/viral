import type { ProjectFormat } from "@viral/contracts"
import { Tooltip } from "@viral/ui/primitives/tooltip"
import { VideoDot } from "../sets/video-badge.tsx"
import { nameOf, useShortVideos } from "./short-videos.tsx"

// A short from several videos, in the title bar: how many it uses, and plainly what still uses its first video
// only. A narrated short uses every video in its script, voice and shots, a cut-down short in its sections; only the
// thumbnail is from the first video for now.
export function MultiVideoNote({ count, format }: { readonly count: number; readonly format: ProjectFormat }) {
  const videos = useShortVideos()
  if (count < 2) return null
  const cutDown = format === "cut-down"
  const first = nameOf(videos, 0)
  return (
    <Tooltip
      content={
        <div className="grid gap-1.5">
          <div className="grid gap-0.5">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="flex min-w-0 items-center gap-1.5">
                <VideoDot index={i} />
                <span className="truncate">{videos.titles[i] ?? nameOf(videos, i)}</span>
              </div>
            ))}
          </div>
          <div className="text-fg-2">
            {cutDown ? "Sections" : "Real lines and shots"} can come from any of them, marked with the video's colour and name. The
            thumbnail uses pictures from the first video, {first}, for now.
          </div>
        </div>
      }
    >
      <span className="no-drag inline-flex h-7 items-center gap-1.5 rounded-ctl bg-ctl px-2 text-xs text-fg-1">
        <span className="flex items-center gap-0.5">{Array.from({ length: count }, (_, i) => <VideoDot key={i} index={i} />)}</span>
        {count} videos
      </span>
    </Tooltip>
  )
}
