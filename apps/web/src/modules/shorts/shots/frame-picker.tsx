import { useAtomValue } from "@effect/atom-react"
import type { FrameAt, SourceId } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"
import { VideoBadge } from "../../sets/video-badge.tsx"
import { InspectorBlock } from "../editor-frame.tsx"
import { framesAroundAtom, framesKey } from "../shorts-api.ts"
import { mmss } from "./shots-values.ts"

const NEAR = 3
const WIDE = 8

// A still from one of the short's videos (V1 = 0), picked or being tried for a shot.
export type PickedFrame = FrameAt & { readonly source: number }

// One of the short's videos as the picker offers it.
export interface PickerVideo {
  readonly sourceId: SourceId
  readonly title: string
  readonly seconds: number
}

// Stills a second apart around the shot's moment, from the shot's own video or (in a short from several videos)
// another one. Clicking one tries it on the stage; "Use" puts it in your edit. The arrows move earlier or later,
// "Wider" looks further either side.
export function FramePicker({ videos, source, around, current, chosen, onChoose, onUse, onCancel, stillUrl }: {
  // the short's videos, V1 first
  readonly videos: ReadonlyArray<PickerVideo>
  // the shot's video now
  readonly source: number
  readonly around: number
  // the shot's source second now
  readonly current: number
  readonly chosen: PickedFrame | null
  readonly onChoose: (frame: PickedFrame | null) => void
  readonly onUse: (frame: PickedFrame) => void
  readonly onCancel: () => void
  readonly stillUrl: (path: string, source: number) => string
}) {
  const [span, setSpan] = useState(NEAR)
  const [video, setVideo] = useState(source)
  const [at, setAt] = useState(around)
  const length = videos[video]?.seconds ?? 0
  const centre = length > 0 ? Math.min(Math.max(0, at), length) : Math.max(0, at)
  const sourceId = videos[video]?.sourceId ?? videos[0]!.sourceId
  const step = span * 2 + 1
  const result = useAtomValue(framesAroundAtom(framesKey(sourceId, centre, span)))
  const frames = Option.getOrElse(AsyncResult.value(result), () => ({ frames: [] as ReadonlyArray<FrameAt> })).frames
  const loading = AsyncResult.isWaiting(result) || (AsyncResult.isInitial(result) && frames.length === 0)
  return (
    <InspectorBlock
      title={`Frames around ${mmss(centre)}`}
      action={
        <span className="flex gap-1">
          <IconButton label="Earlier frames" disabled={centre <= 0} onClick={() => setAt(centre - step)}><ChevronLeft /></IconButton>
          <IconButton label="Later frames" disabled={length > 0 && centre >= length} onClick={() => setAt(centre + step)}><ChevronRight /></IconButton>
        </span>
      }
    >
      {videos.length < 2 ? null : (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Video">
          {videos.map((v, i) => (
            <button
              key={v.sourceId}
              type="button"
              role="radio"
              aria-checked={i === video}
              title={v.title}
              onClick={() => {
                setVideo(i)
                // the shot's own moment in its own video; elsewhere start near the same time, or the middle
                setAt(i === source ? around : around < v.seconds ? around : v.seconds / 2)
                onChoose(null)
              }}
              className={cn(
                "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-ctl px-1.5 text-xs outline-none",
                i === video ? "bg-ctl-active text-fg shadow-[inset_0_0_0_1px_var(--line-2)]" : "text-fg-2 hover:bg-ctl"
              )}
            >
              <VideoBadge index={i} />
              <span className="max-w-[110px] truncate">{v.title}</span>
            </button>
          ))}
        </div>
      )}
      {loading && frames.length === 0 ? (
        <SkeletonRegion label="Pulling stills from the video" className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-video w-full" />)}
        </SkeletonRegion>
      ) : null}
      {AsyncResult.isFailure(result) ? <span className="text-xs text-danger">Couldn’t get stills from the video.</span> : null}
      <div className="grid grid-cols-3 gap-1.5">
        {frames.map((frame) => {
          const isCurrent = video === source && Math.round(frame.t) === Math.round(current)
          const isChosen = chosen !== null && chosen.source === video && chosen.t === frame.t
          return (
            <button
              key={frame.t}
              type="button"
              onClick={() => onChoose({ ...frame, source: video })}
              title={`Frame at ${mmss(frame.t)}`}
              className={cn(
                "relative aspect-video overflow-hidden rounded-[6px] bg-ctl-active outline-none",
                isChosen ? "shadow-[0_0_0_1px_var(--lemon)]" : isCurrent ? "shadow-[0_0_0_1px_var(--fg-3)]" : "hover:shadow-[0_0_0_1px_var(--line-2)]"
              )}
            >
              <img src={stillUrl(frame.path, video)} alt={`Frame at ${mmss(frame.t)}`} className="size-full object-cover" loading="lazy" />
              <span className="absolute bottom-0.5 left-0.5 rounded-[3px] bg-black/70 px-1 text-[10px] text-white">{mmss(frame.t)}</span>
            </button>
          )
        })}
      </div>
      <span className="text-xs text-fg-2">
        Click a frame to try it on the stage. The outlined one is what the shot shows now.
        {videos.length < 2 || video === source ? null : ` Using one moves this shot to ${`V${video + 1}`}.`}
      </span>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" disabled={span === WIDE} onClick={() => setSpan(WIDE)}>Wider</Button>
        <div className="flex gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={chosen === null} onClick={() => chosen !== null && onUse(chosen)}>
            {chosen === null ? "Pick a frame" : `Use ${videos.length < 2 ? "" : `V${chosen.source + 1} `}${mmss(chosen.t)}`}
          </Button>
        </div>
      </div>
    </InspectorBlock>
  )
}
