import { Popover } from "@base-ui/react/popover"
import * as React from "react"
import { cn } from "../cn.ts"
import { COLLISION_PADDING } from "./select.tsx"

export interface PickerOption<V extends string> {
  readonly value: V
  readonly label: string
  // a muted line under the label: what it's good for
  readonly description?: React.ReactNode
  // small chips beside the label ("Recommended", "On your plan", "Sees images"); the first named in `strong` is lemon
  readonly badges?: ReadonlyArray<string>
  // a muted note on the right (a cost, "Add a key in Accounts")
  readonly note?: React.ReactNode
  // a third, smaller line (how it did in your evals; Detailed mode)
  readonly detail?: React.ReactNode
  // a small square mark on the left (a provider's initials, an icon)
  readonly mark?: React.ReactNode
  readonly disabled?: boolean
  // the heading it sits under; consecutive options with the same group share one
  readonly group?: string
  // extra words the search matches besides the label (an id, the description's text)
  readonly keywords?: string
}

export interface PickerProps<V extends string> {
  readonly value: V
  readonly onChange: (value: V) => void
  readonly options: ReadonlyArray<PickerOption<V>>
  readonly label: string
  // what the button says; the chosen option's label when left out
  readonly display?: React.ReactNode
  readonly className?: string
  readonly placeholder?: string
  // badges drawn in lemon
  readonly strong?: ReadonlyArray<string>
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" className="size-3.5 text-fg-2" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path d="m7 10 5 5 5-5" />
  </svg>
)
const Check = () => (
  <svg viewBox="0 0 24 24" className="size-3.5 text-fg" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" className="size-3.5 text-fg-3" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

// Whether an option matches a search: every word in the label, its keywords or (plain-text) description.
export const pickerMatches = (option: PickerOption<string>, query: string) => {
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== "")
  const text = [option.label, option.keywords ?? "", typeof option.description === "string" ? option.description : "", option.group ?? ""].join(" ").toLowerCase()
  return words.every((w) => text.includes(w))
}

// A choice from a list with more to say than a Select: a 28px button opening a popover with a search, groups, and for
// each option a description, badges, a note and (optionally) a detail line. Arrow keys move, Enter picks, Escape
// closes. Used wherever a model or an agent is chosen (Settings › Agents, the generator panels).
export function Picker<V extends string>({ value, onChange, options, label, display, className, placeholder = "Search…", strong = ["Recommended"] }: PickerProps<V>) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const list = React.useRef<HTMLDivElement | null>(null)
  const shown = options.filter((o) => pickerMatches(o, query))
  const pickable = shown.filter((o) => o.disabled !== true)
  const chosen = options.find((o) => o.value === value)
  const pick = (next: V) => {
    onChange(next)
    setOpen(false)
  }
  React.useEffect(() => {
    if (!open) return
    setQuery("")
    setActive(Math.max(0, options.filter((o) => o.disabled !== true).findIndex((o) => o.value === value)))
  }, [open])
  React.useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  let index = -1
  return (
    <Popover.Root open={open} onOpenChange={(next) => setOpen(next)}>
      <Popover.Trigger
        aria-label={label}
        className={cn(
          "inline-flex h-7 min-w-[140px] cursor-pointer items-center justify-between gap-2 rounded-ctl bg-ctl px-2.5 text-base text-fg outline-none hover:bg-ctl-hover data-[popup-open]:shadow-[inset_0_0_0_1px_var(--lemon)]",
          className
        )}
      >
        <span className="min-w-0 truncate">{display ?? chosen?.label ?? value}</span>
        <Chevron />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={4}
          align="end"
          collisionPadding={COLLISION_PADDING}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          className="z-50"
        >
          <Popover.Popup className="flex max-h-[min(440px,var(--available-height))] w-[min(440px,var(--available-width))] flex-col overflow-hidden rounded-panel bg-pop shadow-pop outline-none">
            <label className="flex h-10 shrink-0 items-center gap-2 px-3 shadow-[inset_0_-1px_0_var(--line)]">
              <SearchIcon />
              <input
                autoFocus
                aria-label={`Search ${label.toLowerCase()}`}
                value={query}
                placeholder={placeholder}
                onChange={(e) => {
                  setQuery(e.currentTarget.value)
                  setActive(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(pickable.length - 1, a + 1)))
                  else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)))
                  else if (e.key === "Enter") {
                    e.preventDefault()
                    const next = pickable[active]
                    if (next !== undefined) pick(next.value)
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-none"
              />
            </label>
            <div ref={list} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-auto overscroll-contain p-1">
              {shown.length === 0 ? <div className="px-2 py-3 text-sm text-fg-2">Nothing matches “{query.trim()}”.</div> : null}
              {shown.map((option, i) => {
                const heading = option.group !== undefined && option.group !== shown[i - 1]?.group
                const enabled = option.disabled !== true
                if (enabled) index++
                const mine = index
                const selected = option.value === value
                return (
                  <React.Fragment key={option.value}>
                    {heading ? <div className={cn("px-2 pb-1 text-xs font-medium text-fg-2", i === 0 ? "pt-1.5" : "pt-3")}>{option.group}</div> : null}
                    <div
                      role="option"
                      aria-selected={selected}
                      aria-disabled={!enabled}
                      data-index={enabled ? mine : undefined}
                      onMouseEnter={() => enabled && setActive(mine)}
                      onClick={() => enabled && pick(option.value)}
                      className={cn(
                        "flex min-w-0 cursor-pointer items-start gap-2.5 rounded-ctl px-2 py-2 outline-none",
                        enabled ? (mine === active ? "bg-ctl" : "") : "cursor-default opacity-50",
                        selected && "bg-sel"
                      )}
                    >
                      {option.mark === undefined ? null : (
                        <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[7px] text-[11px] font-semibold text-fg-1 shadow-[inset_0_0_0_1px_var(--line-2)] [&_svg]:size-3.5">
                          {option.mark}
                        </span>
                      )}
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className={cn("truncate text-base", selected ? "font-medium text-fg" : "text-fg-1")}>{option.label}</span>
                          {(option.badges ?? []).map((b) => (
                            <span
                              key={b}
                              className={cn(
                                "inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[11px] font-medium",
                                strong.includes(b) ? "bg-lemon-soft text-lemon-fg" : "text-fg-2 shadow-[inset_0_0_0_1px_var(--line-2)]"
                              )}
                            >
                              {b}
                            </span>
                          ))}
                        </span>
                        {option.description === undefined ? null : <span className="text-xs text-fg-2">{option.description}</span>}
                        {option.detail === undefined ? null : <span className="text-[11.5px] text-fg-3">{option.detail}</span>}
                      </span>
                      {option.note === undefined ? null : <span className="mt-0.5 shrink-0 text-xs whitespace-nowrap text-fg-2">{option.note}</span>}
                      {selected ? <span className="mt-0.5 shrink-0"><Check /></span> : null}
                    </div>
                  </React.Fragment>
                )
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
