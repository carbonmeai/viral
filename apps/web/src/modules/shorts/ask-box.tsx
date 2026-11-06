import { Button } from "@viral/ui/primitives/button"
import { useState } from "react"
import type { GateControls } from "./gate.ts"
import { InspectorBlock } from "./editor-frame.tsx"

// A note to the step's agent. It answers in the same conversation, so it keeps what it made and changes what
// you asked.
export function AskBox({ gate, who, placeholder }: { readonly gate: GateControls; readonly who: string; readonly placeholder: string }) {
  const [note, setNote] = useState("")
  const waiting = gate.request !== null
  return (
    <InspectorBlock title={`Ask the ${who}`}>
      <textarea
        aria-label={`Note to the ${who}`}
        rows={5}
        className="w-full resize-y rounded-ctl bg-ctl px-2.5 py-2 text-base text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--lemon)] disabled:opacity-50"
        placeholder={placeholder}
        disabled={!waiting}
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />
      <span className="text-xs text-fg-2">
        {waiting
          ? "It answers in the same conversation, so it knows what it already made."
          : "Notes go in while this step is waiting for you."}
      </span>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!waiting || gate.busy || note.trim() === ""} onClick={() => gate.ask(note.trim())}>Send</Button>
      </div>
    </InspectorBlock>
  )
}
