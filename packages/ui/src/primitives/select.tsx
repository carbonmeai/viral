import { Select as BaseSelect } from "@base-ui/react/select"
import type * as React from "react"
import { cn } from "../cn.ts"

export interface SelectOption<V extends string> {
  readonly value: V
  readonly label: React.ReactNode
  // a muted note on the right of the option
  readonly note?: React.ReactNode
  // a second, muted line under the label (a model's description and badges); the option grows to fit it
  readonly description?: React.ReactNode
  // shown greyed out and can't be picked (say why in `note` or `description`)
  readonly disabled?: boolean
  // a heading the option sits under; consecutive options with the same group share one heading
  readonly group?: string
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

// Space kept between a menu and the window's edge. With flip/shift and the available height and width as
// limits, no menu runs off the window: it opens upward when there's no room below, slides left near the
// right edge, and scrolls when it's taller than the room it has.
export const COLLISION_PADDING = 8

// Consecutive options that share a group, in order.
const groupsOf = <V extends string>(options: ReadonlyArray<SelectOption<V>>) => {
  const runs: Array<{ readonly group: string | undefined; readonly items: Array<SelectOption<V>> }> = []
  for (const option of options) {
    const last = runs.at(-1)
    if (last !== undefined && last.group === option.group) last.items.push(option)
    else runs.push({ group: option.group, items: [option] })
  }
  return runs
}

const item = <V extends string>(option: SelectOption<V>) => (
  <BaseSelect.Item
    key={option.value}
    value={option.value}
    disabled={option.disabled === true}
    className={cn(
      "flex min-w-0 cursor-pointer gap-3 rounded-ctl px-2 text-base text-fg-1 outline-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-ctl data-[highlighted]:text-fg data-[selected]:font-medium data-[selected]:text-fg",
      option.description === undefined ? "h-7 items-center" : "items-start py-1.5"
    )}
  >
    {option.description === undefined
      ? <BaseSelect.ItemText className="min-w-0 truncate">{option.label}</BaseSelect.ItemText>
      : (
        <span className="flex min-w-0 flex-col gap-0.5">
          <BaseSelect.ItemText className="min-w-0 truncate">{option.label}</BaseSelect.ItemText>
          <span className="min-w-0 text-xs font-normal text-fg-2">{option.description}</span>
        </span>
      )}
    {option.note === undefined
      ? null
      : <span className={cn("ml-auto text-xs font-normal text-fg-2", option.description === undefined ? "min-w-0 shrink truncate" : "shrink-0 whitespace-nowrap")}>{option.note}</span>}
  </BaseSelect.Item>
)

// One choice from a list, as a 28px button that opens a menu of options, optionally under group headings.
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
        <BaseSelect.Value className="min-w-0 truncate" />
        <BaseSelect.Icon render={<Chevron />} />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          sideOffset={4}
          alignItemWithTrigger={false}
          collisionPadding={COLLISION_PADDING}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          className="z-50"
        >
          <BaseSelect.Popup className="max-h-[min(320px,var(--available-height))] max-w-[min(460px,var(--available-width))] min-w-[var(--anchor-width)] overflow-auto overscroll-contain rounded-panel bg-pop p-1 shadow-pop outline-none">
            {groupsOf(options).map(({ group, items }, i) =>
              group === undefined ? items.map(item) : (
                <BaseSelect.Group key={`${group}-${i}`} className={i === 0 ? undefined : "mt-1"}>
                  <BaseSelect.GroupLabel className="px-2 pt-1.5 pb-1 text-xs font-medium text-fg-2">{group}</BaseSelect.GroupLabel>
                  {items.map(item)}
                </BaseSelect.Group>
              )
            )}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
