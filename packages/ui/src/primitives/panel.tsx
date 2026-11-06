import type * as React from "react"
import { cn } from "../cn.ts"

export interface PanelProps {
  readonly title: React.ReactNode
  readonly count?: React.ReactNode
  // "View all", "Add": on the right of the title
  readonly actions?: React.ReactNode
  readonly children: React.ReactNode
  readonly className?: string
}

// A section of a page: a subtle panel with its title, a count and actions on the right, and rows inside.
export function Panel({ title, count, actions, children, className }: PanelProps) {
  return (
    <section className={cn("rounded-panel bg-panel px-4 pt-3.5 pb-4", className)}>
      <div className="mb-2 flex min-h-7 items-center gap-2">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        {count === undefined ? null : <span className="text-fg-2">{count}</span>}
        {actions === undefined ? null : <div className="ml-auto flex items-center gap-2 text-xs text-fg-2">{actions}</div>}
      </div>
      <div className="flex flex-col gap-[3px]">{children}</div>
    </section>
  )
}
