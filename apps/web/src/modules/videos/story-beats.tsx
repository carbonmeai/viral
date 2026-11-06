import type { StoryBeat } from "@viral/contracts"
import { clock } from "../../lib/format.ts"
import { beatStyle } from "./story-strip.tsx"

// The story beat by beat: what happens, when, and the strongest real lines in it.
export function StoryBeats({ summary, beats }: { readonly summary: string; readonly beats: ReadonlyArray<StoryBeat> }) {
  return (
    <div className="grid gap-2">
      <div className="rounded-panel bg-panel px-4 py-3.5 leading-relaxed text-fg-1">{summary}</div>
      <div className="flex flex-col gap-[3px] rounded-panel bg-panel p-1.5">
        {beats.map((beat, i) => (
          <div key={i} className="grid grid-cols-[90px_minmax(0,1fr)_auto] items-start gap-3 rounded-ctl bg-item px-3 py-2.5">
            <span className="w-fit rounded-chip px-2 py-0.5 text-xs font-medium" style={beatStyle(beat.beat)}>{beat.beat}</span>
            <div className="min-w-0">
              <div>{beat.summary}</div>
              {beat.quotes.map((q, j) => <div key={j} className="mt-1 text-xs text-fg-2">“{q.text}” · {clock(q.start)}</div>)}
            </div>
            <span className="text-xs text-fg-2 tabular-nums">{clock(beat.start)}–{clock(beat.end)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
