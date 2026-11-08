import type { ProjectFormat } from "@viral/contracts"
import { Tooltip } from "@viral/ui/primitives/tooltip"
import { Layers } from "lucide-react"
import { VideoBadge } from "../sets/video-badge.tsx"

// A short from several videos, in the title bar: how many it uses, and plainly what still shows its first video
// only. A narrated short uses every video in its script, voice and shots (only the thumbnail is V1 for now); a
// cut-down short's steps learn the others next.
export function MultiVideoNote({ count, format }: { readonly count: number; readonly format: ProjectFormat }) {
  if (count < 2) return null
  const cutDown = format === "cut-down"
  return (
    <Tooltip
      content={cutDown
        ? `This short uses ${count} videos. Its steps show V1 only for now; sections across every video come next.`
        : `This short uses ${count} videos: real lines and shots can come from any of them, badged V1, V2… The thumbnail is made from V1 for now.`}
    >
      <span className="no-drag inline-flex h-7 items-center gap-1.5 rounded-ctl bg-ctl px-2 text-xs text-fg-1">
        <Layers className="size-3.5 text-fg-2" />
        {count} videos
        {cutDown ? (
          <>
            <span className="text-fg-2">· steps show</span>
            <VideoBadge index={0} />
            <span className="text-fg-2">only</span>
          </>
        ) : null}
      </span>
    </Tooltip>
  )
}
