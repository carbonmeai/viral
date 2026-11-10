import { cn } from "@viral/ui/cn"
import type { ReactNode } from "react"

// The short's editor fills the window: the top bar, then the rail, the open panel and the player side by side over
// the timeline, with the chat column on the right at full height. Changing step, panel or selection only swaps what's
// inside these regions; the frame never changes shape. Below about 1100px the chat column becomes an overlay the top
// bar opens (`sideOpen`).
export function EditorFrame({ top, rail, panel, player, side, sideOpen, timeline }: {
  readonly top: ReactNode
  readonly rail: ReactNode
  readonly panel: ReactNode
  readonly player: ReactNode
  readonly side: ReactNode
  readonly sideOpen: boolean
  readonly timeline: ReactNode
}) {
  return (
    <div className="relative grid h-full min-h-0 grid-cols-[minmax(0,1fr)_352px] max-[1281px]:grid-cols-[minmax(0,1fr)_316px] max-[1100px]:grid-cols-[minmax(0,1fr)]">
      <div className="grid min-h-0 min-w-0 grid-rows-[48px_minmax(0,1fr)_auto] bg-bg">
        {top}
        <div className="grid min-h-0 grid-cols-[64px_316px_minmax(0,1fr)] max-[1281px]:grid-cols-[60px_284px_minmax(0,1fr)]">
          {rail}
          <section aria-label="Panel" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-win shadow-[inset_-1px_0_0_var(--line)]">{panel}</section>
          <section aria-label="Player" className="flex min-h-0 min-w-0 flex-col bg-stage">{player}</section>
        </div>
        <div className="max-h-[42vh] min-w-0 overflow-auto bg-bg px-3.5 pt-2 pb-3 shadow-[inset_0_1px_0_var(--line)]">{timeline}</div>
      </div>
      <aside
        aria-label="Agent"
        className={cn(
          "flex min-h-0 min-w-0 flex-col bg-win shadow-[inset_1px_0_0_var(--line)]",
          "max-[1100px]:absolute max-[1100px]:inset-y-0 max-[1100px]:right-0 max-[1100px]:z-30 max-[1100px]:w-[340px] max-[1100px]:shadow-pop",
          !sideOpen && "max-[1100px]:hidden"
        )}
      >
        {side}
      </aside>
    </div>
  )
}

// A titled block inside a panel: a small heading (with an optional action on its right), then its content.
export function InspectorBlock({ title, action, children }: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs font-medium text-fg-2"><span>{title}</span>{action}</div>
      {children}
    </div>
  )
}

// Label–value pairs (length, pace, model, cost).
export function Facts({ rows }: { readonly rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-fg-2">{label}</dt>
          <dd className="m-0 text-right">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
