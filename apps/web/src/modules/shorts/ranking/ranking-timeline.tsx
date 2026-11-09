import { cn } from "@viral/ui/cn"
import { Music, Trophy } from "lucide-react"
import { videoColor } from "../../sets/set-values.ts"
import { clockOf } from "../editor-values.ts"
import { nameOf, useShortVideos } from "../short-videos.tsx"
import { Block, Lane, SourceStrip, TrackName } from "../timeline.tsx"
import { entryBlocks, rankInk, type RankingDraft } from "./ranking-values.ts"

// A ranking on one timeline: its entries end to end in play order (each tinted with its video's colour, #1 last),
// which video plays when, and the audio (each clip's own; no music).
export function RankingTimeline({ draft, videos, selected, onSelect, head }: {
  readonly draft: RankingDraft
  readonly videos: number
  readonly selected: number | null
  readonly onSelect: (rank: number) => void
  // the playhead, in the short's seconds
  readonly head: number | null
}) {
  const named = useShortVideos()
  const blocks = entryBlocks(draft)
  const total = Math.max(blocks.at(-1)?.end ?? 0, 0.001)
  const ticks: Array<number> = []
  for (let t = 0; t <= total; t += 10) ticks.push(t)
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 pb-1 text-xs text-fg-3">
        <span className="ml-auto">{total.toFixed(1)}s · {blocks.length} entries</span>
      </div>
      <div className="grid grid-cols-[112px_minmax(700px,1fr)] items-center gap-y-1.5">
        <div />
        <div className="relative h-5 text-[11px] text-fg-3">
          {ticks.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / total) * 100}%` }}>{clockOf(t)}</span>)}
        </div>
        <SourceStrip videos={videos} total={total} pieces={blocks} />
        <TrackName icon={Trophy} color="var(--t-shot)" name="Entries" />
        <Lane>
          {blocks.map((b) => (
            <button
              key={b.rank}
              type="button"
              title={`#${b.rank} ${b.label}${videos > 1 ? ` · ${nameOf(named, b.source)}` : ""}`}
              onClick={() => onSelect(b.rank)}
              className={cn(
                "absolute inset-y-0 flex items-center gap-1 overflow-hidden rounded-[6px] bg-ctl-active px-1.5 text-xs outline-none",
                b.rank === selected ? "z-10 shadow-[0_0_0_1px_var(--lemon)]" : "hover:brightness-110"
              )}
              style={{
                left: `${(b.start / total) * 100}%`,
                width: `max(4px, calc(${((b.end - b.start) / total) * 100}% - 2px))`,
                boxShadow: b.rank === selected ? undefined : `inset 0 -3px 0 ${videoColor(b.source)}`
              }}
            >
              <span className="shrink-0 font-bold" style={{ color: rankInk(b.rank, blocks.length) }}>#{b.rank}</span>
              <span className="truncate text-fg-1">{b.label} {b.emoji}</span>
            </button>
          ))}
          {head === null ? null : (
            <span className="pointer-events-none absolute -top-[3px] -bottom-[5px] z-20 w-0.5 bg-lemon" style={{ left: `${(head / total) * 100}%` }} />
          )}
        </Lane>
        <TrackName icon={Music} color="var(--t-music)" name="Audio" />
        <Lane><Block start={0} end={total} total={total} color="" dim label="Each clip’s own sound · rankings have no music" /></Lane>
      </div>
    </div>
  )
}
