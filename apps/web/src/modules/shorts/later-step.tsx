import type { EditorStep } from "./editor-values.ts"

// A step the editor doesn't show yet: said inside the same frame, never a different layout.
export function LaterStep({ step, milestone }: { readonly step: EditorStep; readonly milestone: string }) {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div className="grid gap-1">
        <span className="font-medium">{step.name}</span>
        <span className="text-xs text-fg-2">This step's view comes in {milestone}. Its gate can still be answered from the CLI.</span>
      </div>
    </div>
  )
}
