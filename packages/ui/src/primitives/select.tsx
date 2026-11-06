import { Select as BaseSelect } from "@base-ui/react/select"
import type * as React from "react"
import { cn } from "../cn.ts"

export interface SelectOption<V extends string> {
  readonly value: V
  readonly label: React.ReactNode
  // a muted note on the right of the option
  readonly note?: React.ReactNode
}

export interface SelectProps<V extends string> {
  readonly value: V
  readonly onChange: (value: V) => void
  readonly options: ReadonlyArray<SelectOption<V>>
  readonly label: string
  readonly className?: string
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" className="size-3.5 text-fg-2" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path d="m7 10 5 5 5-5" />
  </svg>
)

// One choice from a list, as a 28px button that opens a menu of options.
export function Select<V extends string>({ value, onChange, options, label, className }: SelectProps<V>) {
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next as V)
      }}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={cn(
          "inline-flex h-7 min-w-[140px] cursor-pointer items-center justify-between gap-2 rounded-ctl bg-ctl px-2.5 text-base text-fg outline-none hover:bg-ctl-hover",
          className
        )}
      >
        <BaseSelect.Value />
        <BaseSelect.Icon render={<Chevron />} />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <BaseSelect.Popup className="max-h-[320px] min-w-[var(--anchor-width)] overflow-auto rounded-panel bg-pop p-1 shadow-pop outline-none">
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                className="flex h-7 cursor-pointer items-center gap-3 rounded-ctl px-2 text-base text-fg-1 outline-none data-[highlighted]:bg-ctl data-[highlighted]:text-fg data-[selected]:font-medium data-[selected]:text-fg"
              >
                <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                {option.note === undefined ? null : <span className="ml-auto text-xs text-fg-2">{option.note}</span>}
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
