import type { Voice } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import type * as React from "react"
import { initials, splitName, voiceLine } from "./voices-values.ts"

// One voice as a row, the way Library › Voices lists them: initials, name (with chips beside it), the voice in
// words, and its actions on the right. With onSelect the row is a choice in a list (role radio, 1px outline when
// picked); its actions still work on their own.
export function VoiceRow({ voice, badges, detail, actions, selected, onSelect, className }: {
  readonly voice: Pick<Voice, "name" | "labels" | "category">
  readonly badges?: React.ReactNode
  // muted text after the description, e.g. the voice id behind Detailed
  readonly detail?: React.ReactNode
  readonly actions?: React.ReactNode
  readonly selected?: boolean
  readonly onSelect?: () => void
  readonly className?: string
}) {
  const name = splitName(voice.name).name
  const line = voiceLine(voice)
  const choosable = onSelect !== undefined
  return (
    <div
      role={choosable ? "radio" : undefined}
      aria-checked={choosable ? selected === true : undefined}
      aria-label={choosable ? name : undefined}
      tabIndex={choosable ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={choosable
        ? (e) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return
          e.preventDefault()
          onSelect()
        }
        : undefined}
      className={cn(
        "flex min-h-[60px] items-center gap-3 rounded-[10px] px-2 py-2.5 outline-none hover:bg-panel",
        choosable && "cursor-pointer focus-visible:bg-panel",
        selected === true && "shadow-[inset_0_0_0_1px_var(--lemon)]",
        className
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ctl-active text-[12px] font-semibold text-fg-1">{initials(voice.name)}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-medium">{name}</span>
          {badges}
        </span>
        <span className="truncate text-[13px] text-fg-2" title={line}>
          {line}
          {detail}
        </span>
      </span>
      {actions === undefined ? null : <span className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>{actions}</span>}
    </div>
  )
}
