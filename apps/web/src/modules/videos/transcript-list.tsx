import type { TranscriptLine } from "@viral/contracts"
import { clock } from "../../lib/format.ts"

// The transcript as it reads: one line per sentence with its time; the kept-out ranges are dimmed.
export function TranscriptList({ lines, keptOut }: { readonly lines: ReadonlyArray<TranscriptLine>; readonly keptOut: (t: number) => boolean }) {
  if (lines.length === 0) {
    return <div className="rounded-panel bg-panel px-4 py-6 text-fg-2">No transcript yet.</div>
  }
  return (
    <div className="rounded-panel bg-panel px-4 py-3">
      {lines.map((line, i) => (
        <div key={i} className={`grid grid-cols-[56px_minmax(0,1fr)] gap-3 py-1 ${keptOut(line.start) ? "text-fg-3 line-through decoration-fg-3/40" : ""}`}>
          <span className="text-xs text-fg-2 tabular-nums">{clock(line.start)}</span>
          <span>{line.text}</span>
        </div>
      ))}
    </div>
  )
}
