import type { WaitingItem } from "@viral/contracts"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@viral/ui/primitives/button"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { Status } from "@viral/ui/primitives/status"
import { Thumb } from "@viral/ui/primitives/thumb"
import { ago } from "../../lib/format.ts"
import { stepOfStage } from "../shorts/editor-values.ts"
import { actionLabel, waitingSub, waitingTarget, waitingTitle } from "./waiting.ts"

export interface WaitingRowsProps {
  readonly items: ReadonlyArray<WaitingItem>
  // the global list names each row's video; a video's own list doesn't
  readonly showVideo: boolean
  // thumbnails by short id
  readonly thumbs: ReadonlyMap<string, string | null>
  // each short's videos as its row names them, by short id (a short from several videos names them all)
  readonly videos?: ReadonlyMap<string, string | null>
  readonly now: number
}

// Steps waiting for you, one row each; opening a row goes to that short (or video) at that step.
const stepSearch = (step: ReturnType<typeof stepOfStage>) => step === undefined ? {} : { step }

export function WaitingRows({ items, showVideo, thumbs, videos, now }: WaitingRowsProps) {
  const navigate = useNavigate()
  if (items.length === 0) {
    return <Row className="grid-cols-1"><span className="text-fg-2">Nothing is waiting for you.</span></Row>
  }
  return items.map((item) => {
    const open = () => {
      const target = waitingTarget(item)
      if (target === null) return
      if (target._tag === "Short") void navigate({ to: "/shorts/$projectId", params: { projectId: target.projectId }, search: stepSearch(stepOfStage(item.request.stage)) })
      else if (target._tag === "Set") void navigate({ to: "/sets/$setId", params: { setId: target.setId } })
      else void navigate({ to: "/videos/$sourceId", params: { sourceId: target.sourceId } })
    }
    return (
      <Row key={item.request.id} onOpen={open} className="grid-cols-[minmax(0,1fr)_170px_90px_auto]">
        <RowTitle
          media={<Thumb shape="tall" width={26} src={item.projectId === null ? null : thumbs.get(item.projectId) ?? null} />}
          title={waitingTitle(item)}
          sub={waitingSub(item, showVideo, item.projectId === null ? null : videos?.get(item.projectId))}
        />
        <span><Status tone="wait">{actionLabel(item)}</Status></span>
        <span className="text-xs text-fg-2">{ago(item.request.createdAt.epochMilliseconds, now)}</span>
        <Button onClick={(e) => (e.stopPropagation(), open())}>Open</Button>
      </Row>
    )
  })
}
