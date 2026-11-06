import type { WaitingItem } from "@viral/contracts"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@viral/ui/primitives/button"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { Status } from "@viral/ui/primitives/status"
import { Thumb } from "@viral/ui/primitives/thumb"
import { ago } from "../../lib/format.ts"
import { actionLabel, waitingSub, waitingTitle } from "./waiting.ts"

export interface WaitingRowsProps {
  readonly items: ReadonlyArray<WaitingItem>
  // the global list names each row's video; a video's own list doesn't
  readonly showVideo: boolean
  // thumbnails by short id
  readonly thumbs: ReadonlyMap<string, string | null>
  readonly now: number
}

// Steps waiting for you, one row each; opening a row goes to that short (or video) at that step.
export function WaitingRows({ items, showVideo, thumbs, now }: WaitingRowsProps) {
  const navigate = useNavigate()
  if (items.length === 0) {
    return <Row className="grid-cols-1"><span className="text-fg-2">Nothing is waiting for you.</span></Row>
  }
  return items.map((item) => {
    const open = () =>
      item.projectId === null
        ? navigate({ to: "/videos/$sourceId", params: { sourceId: item.sourceId } })
        : navigate({ to: "/shorts/$projectId", params: { projectId: item.projectId }, search: { step: item.request.stage } })
    return (
      <Row key={item.request.id} onOpen={open} className="grid-cols-[minmax(0,1fr)_170px_90px_auto]">
        <RowTitle
          media={<Thumb shape="tall" width={26} src={item.projectId === null ? null : thumbs.get(item.projectId) ?? null} />}
          title={waitingTitle(item)}
          sub={waitingSub(item, showVideo)}
        />
        <span><Status tone="wait">{actionLabel(item)}</Status></span>
        <span className="text-xs text-fg-2">{ago(item.request.createdAt.epochMilliseconds, now)}</span>
        <Button onClick={(e) => (e.stopPropagation(), open())}>Open</Button>
      </Row>
    )
  })
}
