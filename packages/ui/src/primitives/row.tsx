import type * as React from "react"
import { cn } from "../cn.ts"

export interface RowProps extends React.ComponentProps<"div"> {
  // the row opens something: a pointer and a hover shade
  readonly onOpen?: () => void
}

// An item row inside a panel: a white (or raised) strip, at least 48px tall, with a hover shade.
export function Row({ onOpen, className, children, ...props }: RowProps) {
  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen()) : undefined}
      className={cn("grid min-h-12 items-center gap-3 rounded-ctl bg-item px-3 py-2 hover:bg-item-hover", onOpen && "cursor-pointer", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export interface RowTitleProps {
  readonly media?: React.ReactNode
  readonly title: React.ReactNode
  readonly sub?: React.ReactNode
}

// A row's main cell: an optional thumbnail, the title and a muted line under it.
export function RowTitle({ media, title, sub }: RowTitleProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {media}
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{title}</span>
        {sub === undefined ? null : <span className="truncate text-xs text-fg-2">{sub}</span>}
      </div>
    </div>
  )
}
