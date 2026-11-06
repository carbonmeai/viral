import type { TranscriptWord, Voiceover } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Pause, Play } from "lucide-react"
import { Fragment, useEffect, useRef, useState } from "react"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { Detail } from "../../system/detail.tsx"
import { peaksOf, wordIndexAt } from "./voice-values.ts"

const BARS = 160

// The waveform of the take, drawn from the audio itself (decoded in the browser), filled up to the playhead.
function Waveform({ url, duration, time, pauses, onSeek }: {
  readonly url: string
  readonly duration: number
  readonly time: number
  readonly pauses: ReadonlyArray<number>
  readonly onSeek: (t: number) => void
}) {
  const [peaks, setPeaks] = useState<ReadonlyArray<number>>([])
  const [decoding, setDecoding] = useState(true)
  useEffect(() => {
    let live = true
    setDecoding(true)
    const context = new AudioContext()
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        if (live) setPeaks(peaksOf(buffer.getChannelData(0), BARS))
      })
      .catch(() => {
        if (live) setPeaks([])
      })
      .finally(() => {
        if (live) setDecoding(false)
        void context.close()
      })
    return () => {
      live = false
    }
  }, [url])
  const played = duration > 0 ? time / duration : 0
  return (
    <div
      className="relative h-20 w-full cursor-pointer"
      role="slider"
      aria-label="Position in the voiceover"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      tabIndex={0}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - box.left) / box.width) * duration)
      }}
    >
      {decoding && peaks.length === 0 ? (
        // the waveform's shape in grey while the take decodes
        <SkeletonRegion label="Reading the take" className="absolute inset-0 flex items-center gap-[2px]">
          {Array.from({ length: 64 }, (_, i) => <Skeleton key={i} className="w-full" style={{ height: `${28 + 44 * Math.abs(Math.sin(i * 0.7))}%` }} />)}
        </SkeletonRegion>
      ) : null}
      <svg viewBox={`0 0 ${BARS} 100`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        {peaks.map((p, i) => {
          const h = Math.max(3, p * 96)
          return <rect key={i} x={i + 0.2} y={50 - h / 2} width={0.6} height={h} rx={0.3} fill={i / BARS < played ? "var(--lemon)" : "var(--fg-3)"} />
        })}
      </svg>
      {pauses.map((at, i) => (
        <span key={i} title="A real line plays here" className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-t-real" style={{ left: `${(at / duration) * 100}%` }} />
      ))}
    </div>
  )
}

// The voice step: play the take, see its waveform, and follow the words as they're spoken. Real lines play
// in the creator's voice where the orange marks are.
export function VoiceStage({ voiceover, words, url, voiceName, pauses, onTime }: {
  readonly voiceover: Voiceover
  readonly words: ReadonlyArray<TranscriptWord>
  readonly url: string | null
  readonly voiceName: string
  // voiceover seconds where real lines play
  readonly pauses: ReadonlyArray<number>
  readonly onTime: (t: number | null) => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const t = audio.current?.currentTime ?? 0
      setTime(t)
      onTime(t)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, onTime])
  useEffect(() => () => onTime(null), [onTime])

  const toggle = () => {
    const el = audio.current
    if (el === null) return
    if (el.paused) void el.play()
    else el.pause()
  }
  const seek = (t: number) => {
    if (audio.current !== null) audio.current.currentTime = t
    setTime(t)
    onTime(t)
  }
  const current = wordIndexAt(words, time)
  const afterWord = new Set(pauses.map((at) => words.findIndex((w) => Math.abs(w.e - at) < 0.001)))

  return (
    <div className="mx-auto grid w-full max-w-[680px] gap-5 px-5 pt-5 pb-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={playing ? "Pause the voiceover" : "Play the voiceover"}
          disabled={url === null}
          onClick={toggle}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-fg text-bg outline-none disabled:opacity-40"
        >
          {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
        </button>
        <div className="grid min-w-0">
          <span className="font-medium">{voiceName} · {voiceover.durationS.toFixed(1)}s</span>
          <span className="text-xs text-fg-2">
            {voiceover.pace.toFixed(2)} words a second
            <Detail><> · raw {voiceover.rawPace.toFixed(2)}, sped up ×{voiceover.atempo}</></Detail>
          </span>
        </div>
      </div>
      {url === null ? null : (
        <>
          <Waveform url={url} duration={voiceover.durationS} time={time} pauses={pauses} onSeek={seek} />
          <audio ref={audio} src={url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
        </>
      )}
      <p className="m-0 text-[15px] leading-[1.75]">
        {words.map((w, i) => (
          <Fragment key={i}>
            <span
              onClick={() => seek(w.s)}
              className={cn("cursor-pointer rounded-[4px] px-[1px]", i === current ? "bg-lemon text-lemon-ink" : i < current ? "text-fg" : "text-fg-2")}
            >
              {w.w}
            </span>
            {afterWord.has(i) ? <span className="mx-1 rounded-chip bg-[color-mix(in_srgb,var(--t-real)_16%,transparent)] px-1.5 text-xs text-t-real">real line</span> : " "}
          </Fragment>
        ))}
      </p>
    </div>
  )
}
