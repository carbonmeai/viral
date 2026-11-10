import { Menu as BaseMenu } from "@base-ui/react/menu"
import type * as React from "react"
import { cn } from "../cn.ts"
import { buttonVariants } from "./button.tsx"
import { COLLISION_PADDING } from "./select.tsx"

// The popover surface menus share with Select; it keeps inside the window the same way (flip, shift, scroll).
const POPUP =
  "max-h-[min(360px,var(--available-height))] max-w-[min(320px,var(--available-width))] min-w-[168px] overflow-auto overscroll-contain rounded-panel bg-pop p-1 shadow-pop outline-none"
const ITEM =
  "flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-ctl px-2 text-base text-fg-1 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-ctl data-[highlighted]:text-fg [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-2"

const Dots = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
)

const ChevronRight = () => (
  <svg viewBox="0 0 24 24" className="ml-auto size-3.5 text-fg-2" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path d="m10 7 5 5-5 5" />
  </svg>
)

const Check = () => (
  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

function Positioned({ children, side, align }: {
  readonly children: React.ReactNode
  readonly side?: "bottom" | "inline-end"
  readonly align?: "start" | "end"
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        side={side}
        align={align}
        sideOffset={side === "inline-end" ? 2 : 4}
        collisionPadding={COLLISION_PADDING}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        className="z-50"
      >
        <BaseMenu.Popup className={POPUP}>{children}</BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export interface MenuProps {
  // what screen readers and the tooltip say for the trigger, e.g. "More for Candy theme"
  readonly label: string
  readonly children: React.ReactNode
  // the trigger's content; a 28px ⋯ icon button when left out, a 28px ghost text button otherwise
  readonly trigger?: React.ReactNode
  readonly triggerClassName?: string
  readonly align?: "start" | "end"
  // opened from elsewhere too (e.g. another menu's item); left out, the trigger alone opens it
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
}

// A menu of actions behind a button (⋯ by default). Items close it when picked.
export function Menu({ label, children, trigger, triggerClassName, align = "end", open, onOpenChange }: MenuProps) {
  return (
    <BaseMenu.Root {...(open === undefined ? {} : { open })} {...(onOpenChange === undefined ? {} : { onOpenChange: (next: boolean) => onOpenChange(next) })}>
      <BaseMenu.Trigger
        aria-label={label}
        title={trigger === undefined ? label : undefined}
        className={cn(
          buttonVariants({ variant: "ghost", size: trigger === undefined ? "icon" : "sm" }),
          "data-[popup-open]:bg-ctl data-[popup-open]:text-fg",
          trigger === undefined && "[&_svg]:size-4",
          triggerClassName
        )}
      >
        {trigger ?? <Dots />}
      </BaseMenu.Trigger>
      <Positioned align={align}>{children}</Positioned>
    </BaseMenu.Root>
  )
}

export interface MenuItemProps {
  readonly onClick: () => void
  readonly children: React.ReactNode
  readonly disabled?: boolean
  // "danger" for an action that takes something away
  readonly tone?: "danger"
}

export function MenuItem({ onClick, children, disabled, tone }: MenuItemProps) {
  return (
    <BaseMenu.Item onClick={onClick} disabled={disabled} className={cn(ITEM, tone === "danger" && "text-danger data-[highlighted]:text-danger [&_svg]:text-danger")}>
      {children}
    </BaseMenu.Item>
  )
}

// A nested menu that opens beside its item, on hover or click.
export function MenuSub({ label, children, disabled }: { readonly label: React.ReactNode; readonly children: React.ReactNode; readonly disabled?: boolean }) {
  return (
    <BaseMenu.SubmenuRoot>
      <BaseMenu.SubmenuTrigger disabled={disabled} className={cn(ITEM, "data-[popup-open]:bg-ctl data-[popup-open]:text-fg")}>
        {label}
        <ChevronRight />
      </BaseMenu.SubmenuTrigger>
      <Positioned side="inline-end" align="start">{children}</Positioned>
    </BaseMenu.SubmenuRoot>
  )
}

// One choice from a few, with a check on the current one.
export function MenuChoices<V extends string>({ value, onChange, options }: {
  readonly value: V
  readonly onChange: (value: V) => void
  readonly options: ReadonlyArray<{ readonly value: V; readonly label: React.ReactNode }>
}) {
  return (
    <BaseMenu.RadioGroup
      value={value}
      onValueChange={(next: unknown) => {
        const option = options.find((o) => o.value === next)
        if (option !== undefined && option.value !== value) onChange(option.value)
      }}
    >
      {options.map((option) => (
        <BaseMenu.RadioItem key={option.value} value={option.value} closeOnClick className={cn(ITEM, "data-[checked]:text-fg")}>
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          <BaseMenu.RadioItemIndicator className="ml-auto flex text-fg"><Check /></BaseMenu.RadioItemIndicator>
        </BaseMenu.RadioItem>
      ))}
    </BaseMenu.RadioGroup>
  )
}

// A muted line in a menu, e.g. what a group of items is about.
export function MenuNote({ children }: { readonly children: React.ReactNode }) {
  return <div className="px-2 pt-1 pb-0.5 text-xs text-fg-2">{children}</div>
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-1 my-1 h-px bg-line" />
}
