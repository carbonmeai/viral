import type * as React from "react"
import { cn } from "../cn.ts"

export interface StatProps {
  readonly icon: React.ReactNode
  readonly label: string
  readonly value: React.ReactNode
  readonly sub?: React.ReactNode
  readonly className?: string
}

// A stat card, CarbonMe style: icon and label, a big number, a muted line under it.
export function Stat({ icon, label, value, sub, className }: StatProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-panel bg-panel px-4 py-3.5", className)}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-fg-2 [&_svg]:size-3.5">{icon}{label}</span>
      <span className="text-stat font-semibold tracking-[-0.015em]">{value}</span>
      {sub === undefined ? null : <span className="truncate text-xs text-fg-2">{sub}</span>}
    </div>
  )
}
