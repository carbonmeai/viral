import type * as React from "react"
import { cn } from "../cn.ts"
import { Button } from "./button.tsx"

export interface EmptyStateProps {
  // a lucide icon (or any 16px glyph), shown in a small outlined square
  readonly icon: React.ReactNode
  // what's missing, in a few words ("Nothing is waiting")
  readonly title: string
  // one sentence: what goes here, or why it's empty
  readonly sentence: React.ReactNode
  // at most one thing to do about it; a single action by construction
  readonly action?: { readonly label: string; readonly icon?: React.ReactNode; readonly onClick: () => void; readonly disabled?: boolean }
  readonly className?: string
}

// Every empty place in the app: an icon, a title, one sentence and at most one button, centred in the room it has.
// Music is never nagged for: a short with no song says so as a choice, not a gap.
export function EmptyState({ icon, title, sentence, action, className }: EmptyStateProps) {
  return (
    <div role="status" className={cn("grid justify-items-center gap-2 px-4 py-8 text-center", className)}>
      <span aria-hidden className="mb-1 grid size-11 place-items-center rounded-[10px] text-fg-1 shadow-[inset_0_0_0_1px_var(--line-2)] [&_svg]:size-4">
        {icon}
      </span>
      <span className="text-sm font-medium text-fg">{title}</span>
      <span className="max-w-[300px] text-xs leading-[1.5] text-fg-2">{sentence}</span>
      {action === undefined ? null : (
        <Button className="mt-2" disabled={action.disabled === true} onClick={action.onClick}>
          {action.icon}
          {action.label}
        </Button>
      )}
    </div>
  )
}
