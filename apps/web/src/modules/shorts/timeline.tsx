import type { LucideIcon } from "lucide-react"
import { Captions, Image, Mic, Music, Quote } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@viral/ui/cn"
import { clockOf, type TimelineLayout, type TimelineSegment } from "./editor-values.ts"
import type { ShotBlock } from "./shots/shots-values.ts"

// One track's colour tile, like Cap's soft icon tiles.
export function TrackName({ icon: Icon, color, name }: { readonly icon: LucideIcon; readonly color: string; readonly name: string }) {
  return (
    <div className="flex h-9 items-center gap-2 text-xs text-fg-1">
      <span
        className="grid size-6 place-items-center rounded-[6px]"
        style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color: `color-mix(in srgb, ${color} 70%, var(--fg))` }}
      >
        <Icon className="size-3.5" />
      </span>
      {name}
    </div>
  )
}

export function Lane({ children }: { readonly children?: ReactNode }) {
  return <div className="relative h-9 rounded-ctl bg-ctl">{children}</div>
}

// A coloured block on a lane, from `start` to `end` (seconds), labelled.
export function Block({ start, end, total, color, label, dim }: {
  readonly start: number
  readonly end: number
  readonly total: number
  readonly color: string
  readonly label: ReactNode
  readonly dim?: boolean
}) {
  return (
    <div
      title={typeof label === "string" ? label : undefined}
      className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden rounded-[7px] px-2 text-[11.5px] font-medium whitespace-nowrap"
      style={{
        left: `${(start / total) * 100}%`,
        width: `calc(${((end - start) / total) * 100}% - 2px)`,
        background: dim ? "transparent" : `color-mix(in srgb, ${color} var(--seg-tint), var(--bg))`,
        boxShadow: `inset 0 0 0 1px ${dim ? "var(--line-2)" : `color-mix(in srgb, ${color} 40%, transparent)`}`,
        color: dim ? "var(--fg-3)" : `color-mix(in srgb, ${color} 58%, var(--fg))`
      }}
    >
      {label}
    </div>
  )
}

// The shots as frames on the Shots track, at the times they play; clicking one selects it.
export interface TimelineShots {
  readonly blocks: ReadonlyArray<ShotBlock>
  readonly frameOf: (k: number) => string | null
  readonly selected: number | null
  readonly onSelect: (k: number) => void
}

export interface TimelineProps {
  // null until there's a script and a voiceover to lay out
  readonly layout: TimelineLayout | null
  // the playhead, in the short's seconds
  readonly head?: number | null
  readonly captions: string
  readonly music: string
  readonly shots: string
  // the shot frames, once there's a shot plan
  readonly shotBlocks?: TimelineShots | null
  // where the music drops, in the short's seconds, when it has music
  readonly drop?: number | null
  // the fitted bed's parts (groove, build-up, drop), in the short's seconds, when it has one
  readonly musicBlocks?: ReadonlyArray<TimelineSegment> | null
}

// The short on one timeline, read-only for now: the narration, the shots, the real lines (in the creator's own
// voice), the captions and the music, in the short's own seconds.
export function Timeline({ layout, head, captions, music, shots, shotBlocks, drop, musicBlocks }: TimelineProps) {
  if (layout === null) {
    return (
      <div className="grid grid-cols-[112px_minmax(700px,1fr)] items-center gap-y-1.5">
        <TrackName icon={Mic} color="var(--t-narr)" name="Narration" />
        <Lane><Block start={0} end={1} total={1} color="" dim label="The timeline appears once the voiceover is made" /></Lane>
      </div>
    )
  }
  const total = Math.max(layout.total, 0.001)
  const ticks: Array<number> = []
  for (let t = 0; t <= total; t += 5) ticks.push(t)
  const narrationEnd = layout.narration.at(-1)?.end ?? layout.outroStart
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 pb-1 text-xs text-fg-3">
        <span className="ml-auto">{total.toFixed(1)}s · {layout.reals.length} real lines</span>
      </div>
      <div className="grid grid-cols-[112px_minmax(700px,1fr)] items-center gap-y-1.5">
        <div />
        <div className="relative h-5 text-[11px] text-fg-3">
          {ticks.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / total) * 100}%` }}>{clockOf(t)}</span>)}
        </div>

        <TrackName icon={Mic} color="var(--t-narr)" name="Narration" />
        <Lane>
          {layout.narration.map((n, i) => <Block key={i} start={n.start} end={n.end} total={total} color="var(--t-narr)" label={n.label} />)}
          {head === null || head === undefined ? null : (
            <span className="pointer-events-none absolute -top-[3px] -bottom-[5px] z-10 w-0.5 bg-lemon" style={{ left: `${(head / total) * 100}%` }} />
          )}
        </Lane>

        <TrackName icon={Image} color="var(--t-shot)" name="Shots" />
        <Lane>
          {shotBlocks === null || shotBlocks === undefined ? <Block start={0} end={narrationEnd} total={total} color="" dim label={shots} /> : (
            shotBlocks.blocks.map((b, i) => {
              const src = shotBlocks.frameOf(b.k)
              return (
                <button
                  key={i}
                  type="button"
                  title={`Shot ${b.k + 1}`}
                  aria-label={`Shot ${b.k + 1}`}
                  onClick={() => shotBlocks.onSelect(b.k)}
                  className={cn(
                    "absolute inset-y-0 overflow-hidden rounded-[5px] bg-ctl-active bg-cover bg-center outline-none",
                    b.k === shotBlocks.selected ? "z-10 shadow-[0_0_0_1px_var(--lemon)]" : "hover:brightness-110"
                  )}
                  style={{
                    left: `${(b.start / total) * 100}%`,
                    width: `max(3px, calc(${((b.end - b.start) / total) * 100}% - 1px))`,
                    ...(src === null ? {} : { backgroundImage: `url("${src}")` })
                  }}
                />
              )
            })
          )}
        </Lane>

        <TrackName icon={Quote} color="var(--t-real)" name="Real lines" />
        <Lane>
          {layout.reals.map((r, i) => <Block key={i} start={r.start} end={r.end} total={total} color="var(--t-real)" label={r.label} />)}
        </Lane>

        <TrackName icon={Captions} color="var(--t-cap)" name="Captions" />
        <Lane><Block start={0} end={total} total={total} color="var(--t-cap)" label={captions} /></Lane>

        <TrackName icon={Music} color="var(--t-music)" name="Music" />
        <Lane>
          {musicBlocks === null || musicBlocks === undefined || musicBlocks.length === 0
            ? <Block start={0} end={total} total={total} color="" dim label={music} />
            : musicBlocks.map((b, i) => <Block key={i} start={b.start} end={Math.min(b.end, total)} total={total} color="var(--t-music)" label={b.label} />)}
          {drop === null || drop === undefined ? null : (
            <span className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-[var(--t-music)]" style={{ left: `${(drop / total) * 100}%` }} title="The drop">
              {/* a fitted bed's Drop block names it already */}
              {musicBlocks === null || musicBlocks === undefined || musicBlocks.length === 0
                ? <span className="absolute top-0.5 left-1 text-[10.5px] font-medium text-[color-mix(in_srgb,var(--t-music)_70%,var(--fg))]">drop</span>
                : null}
            </span>
          )}
        </Lane>
      </div>
    </div>
  )
}
