import type { LucideIcon } from "lucide-react"
import { Captions, Image, Mic, Music, Quote } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@viral/ui/cn"
import { videoColor } from "../sets/set-values.ts"
import { clockOf, type TimelineLayout, type TimelineSegment } from "./editor-values.ts"
import type { ShotBlock } from "./shots/shots-values.ts"
import { nameOf, useShortVideos } from "./short-videos.tsx"

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
export function Block({ start, end, total, color, label, title, dim }: {
  readonly start: number
  readonly end: number
  readonly total: number
  readonly color: string
  readonly label: ReactNode
  // the hover text, when the label isn't plain text
  readonly title?: string
  readonly dim?: boolean
}) {
  return (
    <div
      title={title ?? (typeof label === "string" ? label : undefined)}
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
  // each shot's video (the first = 0), for tinting them in a short from several videos
  readonly sourceOf?: (k: number) => number
  readonly selected: number | null
  readonly onSelect: (k: number) => void
}

// The arrangement's parts on the Music track, where each plays (its loops as ticks); clicking one selects it.
export interface TimelineMusicParts {
  readonly parts: ReadonlyArray<{ readonly index: number; readonly start: number; readonly end: number; readonly label: string; readonly ticks: ReadonlyArray<number> }>
  readonly selected: number | null
  readonly onSelect: (index: number) => void
}

// A word on the narration something starts on (the drop, a pinned part), in the short's seconds.
export interface TimelineMark {
  readonly at: number
  readonly label: string
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
  // the arrangement's parts, drawn instead of `musicBlocks` when given
  readonly musicParts?: TimelineMusicParts | null
  // the drop word and pinned words, marked on the narration
  readonly marks?: ReadonlyArray<TimelineMark>
  // how many videos the short has: with more than one, shots and real lines are tinted by their video
  readonly videos?: number
}

// The short on one timeline, read-only for now: the narration, the shots, the real lines (in the creator's own
// voice), the captions and the music, in the short's own seconds.
export function Timeline({ layout, head, captions, music, shots, shotBlocks, drop, musicBlocks, musicParts, marks, videos = 1 }: TimelineProps) {
  const named = useShortVideos()
  const multi = videos > 1
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
          {marks?.map((m, i) => (
            <span
              key={i}
              title={m.label}
              className="absolute -bottom-[3px] z-[5] size-[7px] -translate-x-1/2 rotate-45 rounded-[1px] bg-lemon shadow-[0_0_0_1.5px_var(--bg)]"
              style={{ left: `${(m.at / total) * 100}%` }}
            />
          ))}
          {head === null || head === undefined ? null : (
            <span className="pointer-events-none absolute -top-[3px] -bottom-[5px] z-10 w-0.5 bg-lemon" style={{ left: `${(head / total) * 100}%` }} />
          )}
        </Lane>

        <TrackName icon={Image} color="var(--t-shot)" name="Shots" />
        <Lane>
          {shotBlocks === null || shotBlocks === undefined ? <Block start={0} end={narrationEnd} total={total} color="" dim label={shots} /> : (
            shotBlocks.blocks.map((b, i) => {
              const src = shotBlocks.frameOf(b.k)
              const source = shotBlocks.sourceOf?.(b.k) ?? 0
              return (
                <button
                  key={i}
                  type="button"
                  title={multi ? `Shot ${b.k + 1} · ${nameOf(named, source)}` : `Shot ${b.k + 1}`}
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
                >
                  {multi ? <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: videoColor(source) }} /> : null}
                </button>
              )
            })
          )}
        </Lane>

        <TrackName icon={Quote} color="var(--t-real)" name="Real lines" />
        <Lane>
          {layout.reals.map((r, i) => (
            <Block
              key={i}
              start={r.start}
              end={r.end}
              total={total}
              color={multi ? videoColor(r.source) : "var(--t-real)"}
              title={multi ? `${named.titles[r.source] ?? nameOf(named, r.source)} · ${r.label}` : r.label}
              label={r.label}
            />
          ))}
        </Lane>

        <TrackName icon={Captions} color="var(--t-cap)" name="Captions" />
        <Lane><Block start={0} end={total} total={total} color="var(--t-cap)" label={captions} /></Lane>

        <TrackName icon={Music} color="var(--t-music)" name="Music" />
        <Lane>
          {musicParts !== null && musicParts !== undefined && musicParts.parts.length > 0
            ? musicParts.parts.map((p) => (
              <button
                key={p.index}
                type="button"
                title={p.label}
                onClick={() => musicParts.onSelect(p.index)}
                className={cn(
                  "absolute inset-y-0 flex items-center overflow-hidden rounded-[7px] px-2 text-[11.5px] font-medium whitespace-nowrap outline-none",
                  "bg-[color-mix(in_srgb,var(--t-music)_var(--seg-tint),var(--bg))] text-[color-mix(in_srgb,var(--t-music)_58%,var(--fg))]",
                  p.index === musicParts.selected
                    ? "z-10 shadow-[inset_0_0_0_1px_var(--lemon)]"
                    : "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--t-music)_40%,transparent)] hover:brightness-110"
                )}
                style={{ left: `${(p.start / total) * 100}%`, width: `calc(${((Math.min(p.end, total) - p.start) / total) * 100}% - 2px)` }}
              >
                {p.ticks.map((t) => (
                  <span
                    key={t}
                    className="absolute inset-y-2 w-px bg-[color-mix(in_srgb,var(--t-music)_45%,transparent)]"
                    style={{ left: `${((t - p.start) / Math.max(p.end - p.start, 0.001)) * 100}%` }}
                  />
                ))}
                <span className="relative">{p.label}</span>
              </button>
            ))
            : musicBlocks === null || musicBlocks === undefined || musicBlocks.length === 0
            ? <Block start={0} end={total} total={total} color="" dim label={music} />
            : musicBlocks.map((b, i) => <Block key={i} start={b.start} end={Math.min(b.end, total)} total={total} color="var(--t-music)" label={b.label} />)}
          {drop === null || drop === undefined ? null : (
            <span className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-[var(--t-music)]" style={{ left: `${(drop / total) * 100}%` }} title="The drop">
              {/* a fitted bed's Drop block names it already */}
              {(musicBlocks === null || musicBlocks === undefined || musicBlocks.length === 0) && (musicParts === null || musicParts === undefined)
                ? <span className="absolute top-0.5 left-1 text-[10.5px] font-medium text-[color-mix(in_srgb,var(--t-music)_70%,var(--fg))]">drop</span>
                : null}
            </span>
          )}
        </Lane>
      </div>
    </div>
  )
}
