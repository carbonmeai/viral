import { cn } from "@viral/ui/cn"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { type ReactNode, useEffect, useState } from "react"
import { peaksOf } from "../voice/voice-values.ts"

// A stretch of the audio, in its own seconds.
export interface Span {
  readonly from: number
  readonly to: number
}

// A song's or a bed's waveform, decoded in the page (adapted from Library › Music's track waveform), with the drop
// marked and where it's playing. `lit` brightens the parts that play (the rest is dimmed); `shaded` tints
// stretches (where a real line plays over the bed); `overlay` draws on top, given the audio's length. Skeleton bars
// while the audio downloads and decodes.
export function MusicWaveform({ url, durationS, dropS, time, onSeek, lit, shaded, bars = 140, tall, overlay }: {
  readonly url: string
  readonly durationS: number | null
  readonly dropS: number | null
  // where playback is, in seconds; null when stopped
  readonly time: number | null
  readonly onSeek?: (seconds: number) => void
  readonly lit?: ReadonlyArray<Span> | undefined
  readonly shaded?: ReadonlyArray<Span & { readonly title: string }> | undefined
  readonly bars?: number
  readonly tall?: boolean
  readonly overlay?: (lengthS: number) => ReactNode
}) {
  const [peaks, setPeaks] = useState<ReadonlyArray<number> | null>(null)
  const [decodedLength, setDecodedLength] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    setPeaks(null)
    const context = new AudioContext()
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        if (!live) return
        setPeaks(peaksOf(buffer.getChannelData(0), bars))
        setDecodedLength(buffer.duration)
      })
      .catch(() => {
        if (live) setPeaks([])
      })
      .finally(() => void context.close())
    return () => {
      live = false
    }
  }, [url, bars])

  const length = durationS ?? decodedLength
  const pct = (seconds: number) => (length === null || length <= 0 ? 0 : (seconds / length) * 100)
  const height = tall ? "h-20" : "h-14"

  if (peaks === null) {
    return (
      <SkeletonRegion label="Reading the music" className={cn("flex items-center gap-[2px]", height)}>
        {Array.from({ length: Math.min(bars, 96) }, (_, i) => (
          <Skeleton key={i} className="w-full rounded-[1px]" style={{ height: `${30 + ((i * 37) % 55)}%` }} />
        ))}
      </SkeletonRegion>
    )
  }
  if (peaks.length === 0) return <div className={cn("flex items-center text-xs text-fg-2", height)}>Couldn’t draw this waveform.</div>

  const isLit = (i: number) => {
    if (lit === undefined || length === null) return true
    const t = ((i + 0.5) / peaks.length) * length
    return lit.some((s) => t >= s.from && t <= s.to)
  }
  const played = time === null || length === null ? -1 : (time / length) * peaks.length

  return (
    <div
      className={cn("relative flex items-center gap-[2px]", height, onSeek !== undefined && "cursor-pointer")}
      onClick={(e) => {
        if (length === null || onSeek === undefined) return
        const box = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - box.left) / box.width) * length)
      }}
    >
      {shaded?.map((s, i) => (
        <span
          key={i}
          title={s.title}
          className="absolute inset-y-0 rounded-[3px] bg-[color-mix(in_srgb,var(--t-real)_14%,transparent)]"
          style={{ left: `${pct(s.from)}%`, width: `${pct(s.to - s.from)}%` }}
        />
      ))}
      {peaks.map((p, i) => (
        <span
          key={i}
          className={cn("relative w-full rounded-[1px]", i < played ? "bg-lemon" : isLit(i) ? "bg-t-music" : "bg-fg-3 opacity-40")}
          style={{ height: `${Math.max(6, p * 100)}%` }}
        />
      ))}
      {dropS === null || length === null ? null : (
        <span className="absolute inset-y-[-4px] w-px bg-lemon" style={{ left: `${pct(dropS)}%` }}>
          <span className="absolute -top-4 -translate-x-1/2 rounded-[3px] bg-lemon px-1 text-[9px] font-semibold text-lemon-ink">drop</span>
        </span>
      )}
      {time === null || length === null ? null : <span className="absolute inset-y-0 w-px bg-fg" style={{ left: `${pct(time)}%` }} />}
      {overlay === undefined || length === null ? null : overlay(length)}
    </div>
  )
}
