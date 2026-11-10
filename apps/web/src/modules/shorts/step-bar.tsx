import { cn } from "@viral/ui/cn"
import { Check } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import type { EditorStep, EditorStepId, EditorStepState } from "./editor-values.ts"

// The short's steps in order, slim, in the editor's top bar. Done steps (✓) and the current one can be opened; later
// ones are greyed until the run gets there; the waiting one gets a dot. When the names don't fit the room the top bar
// leaves (a window under about 1200px, or two buttons on the right) they fold into numbers; each step's name is still
// its tooltip and accessible name.
export function StepBar({ steps, states, open, onOpen }: {
  readonly steps: ReadonlyArray<EditorStep>
  readonly states: ReadonlyMap<EditorStepId, EditorStepState>
  readonly open: EditorStepId
  readonly onOpen: (step: EditorStepId) => void
}) {
  // the room for the bar, and how wide it is with every name showing (measured while they show)
  const room = useRef<HTMLDivElement | null>(null)
  const bar = useRef<HTMLElement | null>(null)
  const full = useRef(0)
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    const box = room.current
    if (box === null) return
    const fit = () => {
      if (!compact && bar.current !== null) full.current = bar.current.scrollWidth
      setCompact(full.current > box.clientWidth)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [compact, steps.length])
  return (
    <div ref={room} className="flex min-w-0 flex-1 justify-center">
    <nav ref={bar} aria-label="Steps" className="no-drag flex shrink-0 items-center gap-0.5 rounded-[10px] bg-seg-track p-0.5">
      {steps.map((step, i) => {
        const state = states.get(step.id) ?? "next"
        const selected = step.id === open
        const locked = state === "next" && !selected
        return (
          <button
            key={step.id}
            type="button"
            aria-current={selected ? "step" : undefined}
            aria-label={step.name}
            disabled={locked}
            title={locked ? `${step.name} · opens when the run gets here` : state === "done" ? `${step.name} · approved, open to look again` : step.name}
            onClick={() => onOpen(step.id)}
            className={cn(
              "inline-flex h-[26px] items-center gap-[5px] rounded-ctl px-2 text-xs whitespace-nowrap text-fg-2 outline-none focus-visible:shadow-[0_0_0_1px_var(--lemon)]",
              selected ? "bg-seg-on font-medium text-seg-on-fg shadow-seg-on" : "hover:text-fg",
              locked && "cursor-default text-fg-3 hover:text-fg-3",
              !selected && (state === "waiting" || state === "running") && "text-fg"
            )}
          >
            {state === "done" ? <Check className="size-3 text-ok-dot" /> : null}
            {compact ? (state === "done" ? null : <span className="tabular-nums">{i + 1}</span>) : <span>{step.name}</span>}
            {state === "waiting" ? <span aria-label="waiting for you" className="size-1.5 rounded-full bg-wait-dot" /> : null}
          </button>
        )
      })}
    </nav>
    </div>
  )
}
