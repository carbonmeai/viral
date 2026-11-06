import { cn } from "@viral/ui/cn"
import type { LucideIcon } from "lucide-react"

export interface InspectorTab<T extends string> {
  readonly id: T
  readonly label: string
  readonly icon: LucideIcon
}

// The inspector's 28px icon tabs, side by side; the open one sits on the selection fill.
export function InspectorTabs<T extends string>({ tabs, open, onOpen }: {
  readonly tabs: ReadonlyArray<InspectorTab<T>>
  readonly open: T
  readonly onOpen: (tab: T) => void
}) {
  return (
    <div role="tablist" aria-label="Inspector" className="flex shrink-0 gap-1 px-3 py-2 shadow-[inset_0_-1px_0_var(--line)]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === open}
          aria-label={tab.label}
          title={tab.label}
          onClick={() => onOpen(tab.id)}
          className={cn(
            "grid size-7 place-items-center rounded-ctl text-fg-3 outline-none hover:bg-ctl hover:text-fg",
            tab.id === open && "bg-sel text-fg"
          )}
        >
          <tab.icon className="size-4" />
        </button>
      ))}
    </div>
  )
}
