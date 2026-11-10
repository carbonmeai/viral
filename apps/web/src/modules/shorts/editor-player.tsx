import { Button } from "@viral/ui/primitives/button"
import { Check } from "lucide-react"
import type { ReactNode } from "react"
import { Detail } from "../system/detail.tsx"
import { whatToCheck } from "./editor-values.ts"
import type { EditorState } from "./use-editor-state.ts"

// The player in the middle of the editor: above it, "Waiting for you · what to check" with Ask in chat and Approve
// while the open step waits (else what the step is doing, or that it's approved); then the step's stage (the 9:16
// preview, the take, the bed, the render…); under it the frame size and style, and anything the step adds (`below`).
export function EditorPlayer({ e, note, below, onAsk, children }: {
  readonly e: EditorState
  // a few words about what's shown ("41 words spoken")
  readonly note: string | null
  readonly below?: ReactNode
  readonly onAsk: () => void
  readonly children: ReactNode
}) {
  const { gate, openStep } = e
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-2.5 px-5 pt-3.5 pb-3">
      <div className="flex min-h-9 shrink-0 items-center">
        {gate.request !== null ? (
          <div className="flex h-9 max-w-full items-center gap-2.5 rounded-[10px] bg-item pr-1.5 pl-3 text-[12.5px] shadow-[0_0_0_1px_var(--line)]">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-wait-dot" />
            <span className="truncate"><span className="font-medium">Waiting for you</span> · {whatToCheck(e.open)}</span>
            <Button variant="ghost" onClick={onAsk}>Ask in chat</Button>
            <Button variant="primary" disabled={gate.busy} onClick={gate.approve}><Check />Approve</Button>
          </div>
        ) : e.state === "running" ? (
          <span className="flex items-center gap-2 text-xs text-fg-2">
            <span aria-hidden className="size-1.5 rounded-full bg-run-dot" />{e.working?.message ?? `Working on the ${openStep.name.toLowerCase()}…`}
          </span>
        ) : e.state === "done" ? (
          <span className="flex items-center gap-1.5 text-xs text-fg-2"><Check className="size-3.5 text-ok-dot" />{openStep.name} approved</span>
        ) : null}
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-fg-2">
        <span>1080×1920 · {e.ws.preset.name}</span>
        <Detail><span className="text-fg-3">{e.ws.project.approach}</span></Detail>
        {note === null ? null : <span className="text-fg-3">{note}</span>}
        {below}
      </div>
    </div>
  )
}
