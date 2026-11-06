import { Captions, Film, Music, Scissors } from "lucide-react"
import { cn } from "@viral/ui/cn"
import { clockOf } from "../editor-values.ts"
import { Block, Lane, TrackName } from "../timeline.tsx"
import { BEATS, type EditSection, lengthOf, sectionBlocks } from "./sections-values.ts"

// A cut-down short on one timeline: its sections end to end (coloured by beat, with their frames), the captions,
// where each section comes from in the long video, and the audio (the creator's own; no music).
export function CutTimeline({ sections, sourceSeconds, excluded, stillOf, selected, onSelect, head, captions }: {
  readonly sections: ReadonlyArray<EditSection>
  readonly sourceSeconds: number
  readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number }>
  readonly stillOf: (k: number) => string | null
  readonly selected: number | null
  readonly onSelect: (k: number) => void
  // the playhead, in the short's seconds
  readonly head: number | null
  readonly captions: string
}) {
  const blocks = sectionBlocks(sections)
  const total = Math.max(blocks.at(-1)?.end ?? 0, 0.001)
  const ticks: Array<number> = []
  for (let t = 0; t <= total; t += 5) ticks.push(t)
  const source = Math.max(sourceSeconds, 0.001)
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 pb-1 text-xs text-fg-3">
        <span className="ml-auto">{total.toFixed(1)}s · {sections.length} sections</span>
      </div>
      <div className="grid grid-cols-[112px_minmax(700px,1fr)] items-center gap-y-1.5">
        <div />
        <div className="relative h-5 text-[11px] text-fg-3">
          {ticks.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / total) * 100}%` }}>{clockOf(t)}</span>)}
        </div>

        <TrackName icon={Scissors} color="var(--t-shot)" name="Sections" />
        <Lane>
          {blocks.map((b) => {
            const src = stillOf(b.k)
            const color = BEATS[b.beat].color
            return (
              <button
                key={sections[b.k]!.key}
                type="button"
                title={`Section ${b.k + 1} · ${BEATS[b.beat].label}`}
                aria-label={`Section ${b.k + 1}`}
                onClick={() => onSelect(b.k)}
                className={cn(
                  "absolute inset-y-0 flex items-end overflow-hidden rounded-[6px] bg-ctl-active bg-cover bg-center outline-none",
                  b.k === selected ? "z-10 shadow-[0_0_0_1px_var(--lemon)]" : "hover:brightness-110"
                )}
                style={{
                  left: `${(b.start / total) * 100}%`,
                  width: `max(4px, calc(${((b.end - b.start) / total) * 100}% - 2px))`,
                  ...(src === null ? {} : { backgroundImage: `url("${src}")` })
                }}
              >
                <span className="h-[3px] w-full" style={{ background: color }} />
              </button>
            )
          })}
          {head === null ? null : (
            <span className="pointer-events-none absolute -top-[3px] -bottom-[5px] z-20 w-0.5 bg-lemon" style={{ left: `${(head / total) * 100}%` }} />
          )}
        </Lane>

        <TrackName icon={Captions} color="var(--t-cap)" name="Captions" />
        <Lane><Block start={0} end={total} total={total} color="var(--t-cap)" label={captions} /></Lane>

        <TrackName icon={Film} color="var(--t-narr)" name="From the video" />
        <Lane>
          {excluded.map((r, i) => (
            <span
              key={`ad-${i}`}
              title="Ad or sponsor read: kept out"
              className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--line-2)_0_3px,transparent_3px_7px)]"
              style={{ left: `${(r.start / source) * 100}%`, width: `${((r.end - r.start) / source) * 100}%` }}
            />
          ))}
          {sections.map((s, k) => (
            <button
              key={s.key}
              type="button"
              title={`Section ${k + 1}`}
              aria-label={`Section ${k + 1} in the video`}
              onClick={() => onSelect(k)}
              className={cn("absolute inset-y-1.5 rounded-[3px] outline-none", k === selected && "z-10 shadow-[0_0_0_1px_var(--lemon)]")}
              style={{
                left: `${(s.start / source) * 100}%`,
                width: `max(3px, ${(lengthOf(s) / source) * 100}%)`,
                background: BEATS[s.beat].color
              }}
            />
          ))}
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-fg-3">{clockOf(sourceSeconds)}</span>
        </Lane>

        <TrackName icon={Music} color="var(--t-music)" name="Audio" />
        <Lane><Block start={0} end={total} total={total} color="" dim label="The creator’s own audio · cut-down shorts have no music" /></Lane>
      </div>
    </div>
  )
}
