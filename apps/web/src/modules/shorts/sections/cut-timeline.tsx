import { Captions, Film, Music, Scissors } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@viral/ui/cn"
import { VideoDot } from "../../sets/video-badge.tsx"
import { videoColor } from "../../sets/set-values.ts"
import { clockOf } from "../editor-values.ts"
import { nameOf, useShortVideos } from "../short-videos.tsx"
import { Block, Lane, SourceStrip, TrackName } from "../timeline.tsx"
import { BEATS, type CutVideo, type EditSection, lengthOf, sectionBlocks } from "./sections-values.ts"

// A cut-down short on one timeline: its sections end to end (coloured by beat, with their frames), the captions,
// where each section comes from in the long video, and the audio (the creator's own; no music). In a short from
// several videos each section is tinted with its video's colour, and every video gets its own "from" row.
export function CutTimeline({ sections, videos, stillOf, selected, onSelect, head, captions }: {
  readonly sections: ReadonlyArray<EditSection>
  // the short's videos, V1 first: each one's length and excluded ranges
  readonly videos: ReadonlyArray<Pick<CutVideo, "sourceSeconds" | "excluded">>
  readonly stillOf: (k: number) => string | null
  readonly selected: number | null
  readonly onSelect: (k: number) => void
  // the playhead, in the short's seconds
  readonly head: number | null
  readonly captions: string
}) {
  const named = useShortVideos()
  const blocks = sectionBlocks(sections)
  const total = Math.max(blocks.at(-1)?.end ?? 0, 0.001)
  const ticks: Array<number> = []
  for (let t = 0; t <= total; t += 5) ticks.push(t)
  const several = videos.length > 1
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

        <SourceStrip videos={videos.length} total={total} pieces={blocks} />

        <TrackName icon={Scissors} color="var(--t-shot)" name="Sections" />
        <Lane>
          {blocks.map((b) => {
            const src = stillOf(b.k)
            const color = BEATS[b.beat].color
            const tint = videoColor(b.source)
            return (
              <button
                key={sections[b.k]!.key}
                type="button"
                title={`Section ${b.k + 1} · ${BEATS[b.beat].label}${several ? ` · ${nameOf(named, b.source)}` : ""}`}
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
                <span className={several ? "h-1 w-full" : "h-[3px] w-full"} style={{ background: several ? tint : color }} />
              </button>
            )
          })}
          {head === null ? null : (
            <span className="pointer-events-none absolute -top-[3px] -bottom-[5px] z-20 w-0.5 bg-lemon" style={{ left: `${(head / total) * 100}%` }} />
          )}
        </Lane>

        <TrackName icon={Captions} color="var(--t-cap)" name="Captions" />
        <Lane><Block start={0} end={total} total={total} color="var(--t-cap)" label={captions} /></Lane>

        {videos.map((video, v) => {
          const source = Math.max(video.sourceSeconds, 0.001)
          return (
            <FromRow key={v} name={several ? nameOf(named, v) : null} index={v}>
              {video.excluded.map((r, i) => (
                <span
                  key={`ad-${i}`}
                  title="Ad or sponsor read: kept out"
                  className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--line-2)_0_3px,transparent_3px_7px)]"
                  style={{ left: `${(r.start / source) * 100}%`, width: `${((r.end - r.start) / source) * 100}%` }}
                />
              ))}
              {sections.map((s, k) => (s.source ?? 0) !== v ? null : (
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
                    background: several ? videoColor(v) : BEATS[s.beat].color
                  }}
                />
              ))}
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-fg-3">{clockOf(video.sourceSeconds)}</span>
            </FromRow>
          )
        })}

        <TrackName icon={Music} color="var(--t-music)" name="Audio" />
        <Lane><Block start={0} end={total} total={total} color="" dim label="The creator’s own audio · cut-down shorts have no music" /></Lane>
      </div>
    </div>
  )
}

// Where sections come from in one video: "From the video" for a single-video short, else the video's dot and short
// name, one row per video.
function FromRow({ name, index, children }: { readonly name: string | null; readonly index: number; readonly children: ReactNode }) {
  return (
    <>
      {name === null ? <TrackName icon={Film} color="var(--t-narr)" name="From the video" /> : (
        <div className="flex h-9 min-w-0 items-center gap-2 pl-2 text-xs text-fg-1">
          <VideoDot index={index} />
          <span className="truncate">{name}</span>
        </div>
      )}
      <Lane>{children}</Lane>
    </>
  )
}
