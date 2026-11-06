import { useAtomValue } from "@effect/atom-react"
import type { FrameAt, SourceId } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { InspectorBlock } from "../editor-frame.tsx"
import { framesAroundAtom, framesKey } from "../shorts-api.ts"
import { mmss } from "./shots-values.ts"

const NEAR = 3
const WIDE = 8

// Stills of the long video a second apart around the shot's moment. Clicking one tries it on the stage; "Use"
// puts it in your edit. "Wider" looks further either side.
export function FramePicker({ sourceId, around, current, chosen, onChoose, onUse, onCancel, stillUrl }: {
  readonly sourceId: SourceId
  readonly around: number
  // the shot's source second now
  readonly current: number
  readonly chosen: FrameAt | null
  readonly onChoose: (frame: FrameAt) => void
  readonly onUse: (frame: FrameAt) => void
  readonly onCancel: () => void
  readonly stillUrl: (path: string) => string
}) {
  const [span, setSpan] = useState(NEAR)
  const result = useAtomValue(framesAroundAtom(framesKey(sourceId, around, span)))
  const frames = Option.getOrElse(AsyncResult.value(result), () => ({ frames: [] as ReadonlyArray<FrameAt> })).frames
  const loading = AsyncResult.isWaiting(result) || (AsyncResult.isInitial(result) && frames.length === 0)
  return (
    <InspectorBlock title={`Frames around ${mmss(around)}`} action={<span className="text-xs font-normal text-fg-3">one a second</span>}>
      {loading && frames.length === 0 ? <span className="text-xs text-fg-2">Pulling stills from the video…</span> : null}
      {AsyncResult.isFailure(result) ? <span className="text-xs text-danger">Couldn’t get stills from the video.</span> : null}
      <div className="grid grid-cols-3 gap-1.5">
        {frames.map((frame) => {
          const isCurrent = Math.round(frame.t) === Math.round(current)
          const isChosen = chosen !== null && chosen.t === frame.t
          return (
            <button
              key={frame.t}
              type="button"
              onClick={() => onChoose(frame)}
              title={`Frame at ${mmss(frame.t)}`}
              className={cn(
                "relative aspect-video overflow-hidden rounded-[6px] bg-ctl-active outline-none",
                isChosen ? "shadow-[0_0_0_1px_var(--lemon)]" : isCurrent ? "shadow-[0_0_0_1px_var(--fg-3)]" : "hover:shadow-[0_0_0_1px_var(--line-2)]"
              )}
            >
              <img src={stillUrl(frame.path)} alt={`Frame at ${mmss(frame.t)}`} className="size-full object-cover" loading="lazy" />
              <span className="absolute bottom-0.5 left-0.5 rounded-[3px] bg-black/70 px-1 text-[10px] text-white">{mmss(frame.t)}</span>
            </button>
          )
        })}
      </div>
      <span className="text-xs text-fg-2">
        Click a frame to try it on the stage. The outlined one is what the shot shows now.
      </span>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" disabled={span === WIDE} onClick={() => setSpan(WIDE)}>Wider</Button>
        <div className="flex gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={chosen === null} onClick={() => chosen !== null && onUse(chosen)}>
            {chosen === null ? "Pick a frame" : `Use ${mmss(chosen.t)}`}
          </Button>
        </div>
      </div>
    </InspectorBlock>
  )
}
