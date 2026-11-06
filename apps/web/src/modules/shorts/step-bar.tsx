import { cn } from "@viral/ui/cn"
import { Check } from "lucide-react"
import type { EditorStep, EditorStepId, EditorStepState } from "./editor-values.ts"

// The short's steps in order. Done steps (✓) and the current one can be opened; later ones are greyed until the
// run gets there. A waiting step that isn't open gets a dot, so you see where you're needed.
export function StepBar({ steps, states, open, onOpen }: {
  readonly steps: ReadonlyArray<EditorStep>
  readonly states: ReadonlyMap<EditorStepId, EditorStepState>
  readonly open: EditorStepId
  readonly onOpen: (step: EditorStepId) => void
}) {
  return (
    <div role="tablist" aria-label="Steps" className="inline-flex shrink-0 gap-0.5 rounded-track bg-ctl p-0.5">
      {steps.map((step, i) => {
        const state = states.get(step.id) ?? "next"
        const selected = step.id === open
        const locked = state === "next" && !selected
        return (
          <button
            key={step.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={locked}
            title={locked ? "Opens when the run gets here" : state === "done" ? "Approved · open to look again" : undefined}
            onClick={() => onOpen(step.id)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-ctl px-2.5 text-xs font-medium text-fg-2 outline-none",
              selected ? "bg-seg-on text-seg-on-fg shadow-seg-on" : "hover:text-fg",
              locked && "cursor-not-allowed opacity-45 hover:text-fg-2",
              !selected && (state === "waiting" || state === "running") && "text-fg"
            )}
          >
            {state === "done"
              ? <Check className="size-3.5 text-ok-dot" />
              : (
                <span className={cn("grid size-4 place-items-center rounded-full text-[10px]", selected ? "bg-lemon text-lemon-ink" : "bg-ctl-active")}>
                  {i + 1}
                </span>
              )}
            {step.name}
            {!selected && state === "waiting" ? <span className="size-1.5 rounded-full bg-wait-dot" aria-label="waiting for you" /> : null}
          </button>
        )
      })}
    </div>
  )
}
