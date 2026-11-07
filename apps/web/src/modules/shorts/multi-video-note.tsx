import { Tooltip } from "@viral/ui/primitives/tooltip"
import { Layers } from "lucide-react"
import { VideoBadge } from "../sets/video-badge.tsx"

// A short from several videos, in the title bar: how many it uses, and plainly that the steps still show its first
// video only (each step learns the others in later milestones).
export function MultiVideoNote({ count }: { readonly count: number }) {
  if (count < 2) return null
  return (
    <Tooltip content={`This short uses ${count} videos. The steps show V1 only for now; scripts, shots and sections across every video come next.`}>
      <span className="no-drag inline-flex h-7 items-center gap-1.5 rounded-ctl bg-ctl px-2 text-xs text-fg-1">
        <Layers className="size-3.5 text-fg-2" />
        {count} videos
        <span className="text-fg-2">· steps show</span>
        <VideoBadge index={0} />
        <span className="text-fg-2">only</span>
      </span>
    </Tooltip>
  )
}
