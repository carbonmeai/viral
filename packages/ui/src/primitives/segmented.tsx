import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import type * as React from "react"
import { cn } from "../cn.ts"

export interface SegmentedOption<V extends string> {
  readonly value: V
  readonly label: React.ReactNode
}

export interface SegmentedProps<V extends string> {
  readonly value: V
  readonly onChange: (value: V) => void
  readonly options: ReadonlyArray<SegmentedOption<V>>
  // fill the row, each option the same width
  readonly full?: boolean
  readonly label: string
  readonly className?: string
}

// One choice out of a few, shown side by side. The chosen option is a clearly lighter chip in bold text.
export function Segmented<V extends string>({ value, onChange, options, full, label, className }: SegmentedProps<V>) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(values) => {
        const next = values[0]
        if (next !== undefined) onChange(next as V)
      }}
      className={cn("inline-flex gap-0.5 rounded-track bg-seg-track p-0.5", full && "flex w-full", className)}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-ctl px-3 text-base text-seg-off-fg outline-none hover:text-fg",
            "data-[pressed]:bg-seg-on data-[pressed]:font-medium data-[pressed]:text-seg-on-fg data-[pressed]:shadow-seg-on",
            full && "flex-1 justify-center"
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
