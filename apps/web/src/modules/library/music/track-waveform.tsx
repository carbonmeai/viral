import { Skeleton } from "@viral/ui/primitives/skeleton"
import { useEffect, useState } from "react"
import { peaksOf } from "../../shorts/voice/voice-values.ts"

const BARS = 140

// A track's waveform, decoded in the page, with its drop marked and where it's playing. Skeleton bars while
// the audio downloads and decodes.
export function TrackWaveform({ url, durationS, dropS, buildS, time, onSeek }: {
  readonly url: string
  readonly durationS: number | null
  readonly dropS: number | null
  readonly buildS: number | null
  // where playback is, in seconds; null when stopped
  readonly time: number | null
  readonly onSeek: (seconds: number) => void
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
        setPeaks(peaksOf(buffer.getChannelData(0), BARS))
        setDecodedLength(buffer.duration)
      })
      .catch(() => {
        if (live) setPeaks([])
      })
      .finally(() => void context.close())
    return () => {
      live = false
    }
  }, [url])

  const length = durationS ?? decodedLength
  const at = (seconds: number | null) => (seconds === null || length === null || length <= 0 ? null : `${(seconds / length) * 100}%`)

  if (peaks === null) {
    return (
      <div aria-hidden className="flex h-14 items-center gap-[2px]">
        {Array.from({ length: BARS }, (_, i) => (
          <Skeleton key={i} className="w-full rounded-[1px]" style={{ height: `${30 + ((i * 37) % 55)}%` }} />
        ))}
      </div>
    )
  }
  if (peaks.length === 0) return <div className="flex h-14 items-center text-xs text-fg-2">Couldn’t draw this track’s waveform.</div>

  return (
    <div
      className="relative flex h-14 cursor-pointer items-center gap-[2px]"
      onClick={(e) => {
        if (length === null) return
        const box = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - box.left) / box.width) * length)
      }}
    >
      {peaks.map((p, i) => (
        <span key={i} className="w-full rounded-[1px] bg-fg-3" style={{ height: `${Math.max(6, p * 100)}%` }} />
      ))}
      {at(buildS) === null ? null : <span className="absolute inset-y-0 border-l border-dashed border-fg-2" style={{ left: at(buildS)! }} title="The build-up: 8 bars before the drop" />}
      {at(dropS) === null ? null : (
        <span className="absolute inset-y-[-4px] w-px bg-lemon" style={{ left: at(dropS)! }}>
          <span className="absolute -top-4 -translate-x-1/2 rounded-[3px] bg-lemon px-1 text-[9px] font-semibold text-lemon-ink">drop</span>
        </span>
      )}
      {at(time) === null ? null : <span className="absolute inset-y-0 w-px bg-fg" style={{ left: at(time)! }} />}
    </div>
  )
}
