import type * as React from "react"
import { cn } from "../cn.ts"

export interface SettingsGroupProps {
  // an optional small heading above the group
  readonly title?: React.ReactNode
  readonly children: React.ReactNode
  readonly className?: string
}

// A group of settings: rows in one panel, separated by hairlines.
export function SettingsGroup({ title, children, className }: SettingsGroupProps) {
  return (
    <section className={cn("grid gap-2", className)}>
      {title === undefined ? null : <h2 className="m-0 px-1 text-base font-semibold">{title}</h2>}
      <div className="rounded-panel bg-panel px-4 [&>*+*]:shadow-[inset_0_1px_0_var(--color-line)]">{children}</div>
    </section>
  )
}

export interface SettingRowProps {
  readonly label: React.ReactNode
  // a muted line under the label
  readonly sub?: React.ReactNode
  // the control on the right: a switch, segmented control, select or buttons
  readonly children?: React.ReactNode
  readonly className?: string
}

// One setting: what it is on the left, its control on the right.
export function SettingRow({ label, sub, children, className }: SettingRowProps) {
  return (
    <div className={cn("flex min-h-[52px] items-center gap-4 py-2.5", className)}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{label}</span>
        {sub === undefined ? null : <span className="text-xs text-fg-2">{sub}</span>}
      </div>
      {children === undefined ? null : <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}
