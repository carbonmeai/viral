import type { AdRange, StoryBeat } from "@viral/contracts"
import { clock } from "../../lib/format.ts"
import { storyStrip, stripTicks } from "./video-values.ts"

// Each beat's colour: a quiet tint of its hue with the hue as its text, readable in both themes.
const BEAT_HUE: Record<StoryBeat["beat"], string> = {
  goal: "#a78bfa",
  process: "#60a5fa",
  setback: "#fb923c",
  fix: "#fbbf24",
  result: "#2dd4bf",
  reaction: "#a3e635"
}

export const beatStyle = (beat: StoryBeat["beat"]) => ({
  background: `color-mix(in srgb, ${BEAT_HUE[beat]} 20%, transparent)`,
  color: `color-mix(in srgb, ${BEAT_HUE[beat]} 75%, var(--fg))`
})

// The story across the whole video: a lane of beats, with the ads and end screen hatched as kept out.
export function StoryStrip({ beats, ads, length }: { readonly beats: ReadonlyArray<StoryBeat>; readonly ads: ReadonlyArray<AdRange>; readonly length: number }) {
  const strip = storyStrip(beats, ads, length)
  return (
    <div>
      <div className="relative h-7 overflow-hidden rounded-ctl bg-ctl">
        {strip.beats.map((b, i) => (
          <div
            key={i}
            title={b.summary}
            className="absolute inset-y-0 flex items-center overflow-hidden rounded-[6px] px-2 text-xs font-medium whitespace-nowrap"
            style={{ left: `${b.left}%`, width: `calc(${b.width}% - 2px)`, ...beatStyle(b.beat) }}
          >
            {b.beat}
          </div>
        ))}
        {strip.ads.map((a, i) => (
          <div
            key={`ad-${i}`}
            title={`${a.kind}: kept out of every short`}
            className="absolute inset-y-0"
            style={{
              left: `${a.left}%`,
              width: `${a.width}%`,
              background: "repeating-linear-gradient(135deg, var(--fg-3) 0 2px, transparent 2px 7px)",
              opacity: 0.55
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-fg-3">
        {stripTicks(length).map((t, i) => <span key={i}>{clock(t)}</span>)}
      </div>
    </div>
  )
}
