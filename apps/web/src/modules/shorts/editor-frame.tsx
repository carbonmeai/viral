import type { ReactNode } from "react"

// The short's editor: one frame for every step. The bar holds the steps and the step's actions; below it the
// stage (centre), the inspector (right, full height) and the timeline (under the stage). Changing step, line or
// tab only swaps what's inside these regions; the frame never changes shape.
export function EditorFrame({ bar, stage, inspector, timeline }: {
  readonly bar: ReactNode
  readonly stage: ReactNode
  readonly inspector: ReactNode
  readonly timeline: ReactNode
}) {
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2 shadow-[inset_0_-1px_0_var(--line)]">{bar}</div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_332px] grid-rows-[minmax(0,1fr)_auto]">
        <section className="flex min-h-0 min-w-0 flex-col bg-stage">{stage}</section>
        <aside className="col-start-2 row-span-2 row-start-1 flex min-h-0 flex-col bg-win shadow-[inset_1px_0_0_var(--line)]">{inspector}</aside>
        <div className="col-start-1 row-start-2 min-w-0 overflow-x-auto bg-bg px-3.5 pt-2 pb-3 shadow-[inset_0_1px_0_var(--line)]">{timeline}</div>
      </div>
    </>
  )
}

// A titled block inside the inspector: a small heading (with an optional action on its right), then its content.
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
