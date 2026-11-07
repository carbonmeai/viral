import { Link } from "@tanstack/react-router"
import type { MusicBed, MusicTrack, TranscriptWord } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button, buttonVariants } from "@viral/ui/primitives/button"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { Mic, MicOff, Music, Pause, Play, Plus } from "lucide-react"
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { clockOf, shortTimeOf, type TimelineLayout } from "../editor-values.ts"
import { wordIndexAt } from "../voice/voice-values.ts"
import { bedBlocks, blockLabel, voiceAt } from "./music-values.ts"
import { MusicWaveform } from "./music-waveform.tsx"

// "Add a song": opens the song picker, or Library › Music when there are no songs to pick from.
export function AddSong({ hasSongs, onPick, primary }: { readonly hasSongs: boolean; readonly onPick: () => void; readonly primary?: boolean }) {
  const variant = primary ? "primary" : "default"
  return hasSongs
    ? <Button variant={variant} onClick={onPick}><Plus />Add a song</Button>
    : <Link to="/library/music" className={buttonVariants({ variant })}><Plus />Add a song in Library › Music</Link>
}

// A calm message in the middle of the stage.
function Calm({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div className="grid justify-items-center gap-2">
        <span className="grid size-10 place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--t-music)_14%,transparent)] text-[color-mix(in_srgb,var(--t-music)_70%,var(--fg))]">
          <Music className="size-5" />
        </span>
        <span className="font-medium">{title}</span>
        {children}
      </div>
    </div>
  )
}

// The music step's stage: the short's fitted bed played with the voiceover (which pauses while a real line plays,
// as in the short), so you can hear where the drop lands. The bed's waveform, its parts and the narration's
// words follow along; the drop word is marked, and the words parts of the arrangement are pinned to. While you pick
// a word for a part (`onPickWord`), clicking a word picks it instead of playing from it. `preview`: the bed is a
// preview of your arrangement, not yet applied.
export function MusicStage({ bed, bedUrl, track, fitting, voiceUrl, words, layout, hasSongs, onAddSong, onTime, pins, onPickWord, preview }: {
  readonly bed: MusicBed | null
  readonly bedUrl: string | null
  // the short's song, when it has one (it may not be fitted yet)
  readonly track: MusicTrack | null
  // assemble is fitting a bed right now
  readonly fitting: boolean
  readonly voiceUrl: string | null
  readonly words: ReadonlyArray<TranscriptWord>
  readonly layout: TimelineLayout | null
  readonly hasSongs: boolean
  readonly onAddSong: () => void
  readonly onTime: (shortSeconds: number | null) => void
  // word index → what starts on it ("Part 3 starts here")
  readonly pins?: ReadonlyMap<number, string>
  readonly onPickWord?: ((word: number) => void) | null
  readonly preview?: boolean
}) {
  if (track === null && !fitting) {
    return (
      <Calm title="Voice only">
        <span className="max-w-[340px] text-sm text-fg-2">This short plays without music. Add a song and its drop is fitted to a word of the narration.</span>
        <div className="pt-1"><AddSong hasSongs={hasSongs} onPick={onAddSong} /></div>
      </Calm>
    )
  }
  if (bed === null || bedUrl === null || (track !== null && bed.trackId !== track.id)) {
    if (fitting) {
      return (
        <div className="mx-auto grid w-full max-w-[680px] content-start gap-5 px-5 pt-5">
          <span className="text-sm text-fg-2">Fitting {track === null ? "the song" : `“${track.title}”`} to the voice…</span>
          <SkeletonRegion label="Fitting the song" className="flex h-20 items-center gap-[2px]">
            {Array.from({ length: 96 }, (_, i) => <Skeleton key={i} className="w-full" style={{ height: `${28 + 44 * Math.abs(Math.sin(i * 0.7))}%` }} />)}
          </SkeletonRegion>
        </div>
      )
    }
    return (
      <Calm title={track === null ? "Voice only" : `“${track.title}” isn’t fitted yet`}>
        <span className="max-w-[360px] text-sm text-fg-2">
          {track !== null && (track.bpm === null || track.dropS === null)
            ? "Its tempo and drop aren’t known yet, so the short plays voice only. Set them in Library › Music, then pick it again."
            : "It’s fitted when the short is laid out again."}
        </span>
      </Calm>
    )
  }
  return (
    <BedPlayer
      key={bedUrl}
      bed={bed}
      bedUrl={bedUrl}
      voiceUrl={voiceUrl}
      words={words}
      layout={layout}
      onTime={onTime}
      pins={pins ?? new Map()}
      onPickWord={onPickWord ?? null}
      preview={preview ?? false}
    />
  )
}

function BedPlayer({ bed, bedUrl, voiceUrl, words, layout, onTime, pins, onPickWord, preview }: {
  readonly bed: MusicBed
  readonly bedUrl: string
  readonly voiceUrl: string | null
  readonly words: ReadonlyArray<TranscriptWord>
  readonly layout: TimelineLayout | null
  readonly onTime: (shortSeconds: number | null) => void
  readonly pins: ReadonlyMap<number, string>
  readonly onPickWord: ((word: number) => void) | null
  readonly preview: boolean
}) {
  const music = useRef<HTMLAudioElement>(null)
  const voice = useRef<HTMLAudioElement>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [withVoice, setWithVoice] = useState(true)
  const pauses = layout?.pauses ?? []

  // the bed is the clock; the voiceover follows it, pausing while a real line plays
  useEffect(() => {
    if (!playing) {
      voice.current?.pause()
      return
    }
    let frame = 0
    const tick = () => {
      const t = music.current?.currentTime ?? 0
      setTime(t)
      onTime(t)
      const vo = voice.current
      if (vo !== null) {
        const at = voiceAt(pauses, t)
        if (at.paused || at.t >= (vo.duration || Infinity)) {
          if (!vo.paused) vo.pause()
        } else if (vo.paused) {
          vo.currentTime = at.t
          void vo.play().catch(() => undefined)
        } else if (Math.abs(vo.currentTime - at.t) > 0.12) {
          vo.currentTime = at.t
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pauses change only with a new layout
  }, [playing, onTime, layout])
  useEffect(() => () => onTime(null), [onTime])

  const toggle = () => {
    const el = music.current
    if (el === null) return
    if (el.paused) void el.play()
    else el.pause()
  }
  const seek = (t: number) => {
    if (music.current !== null) music.current.currentTime = t
    const vo = voice.current
    if (vo !== null) vo.currentTime = voiceAt(pauses, t).t
    setTime(t)
    onTime(t)
  }
  const voTime = voiceAt(pauses, time).t
  const current = playing || time > 0 ? wordIndexAt(words, voTime) : -1
  // an arranged bed is labelled by its parts ("Bars 13–16 ×3", "Drop"); an older one by the automatic recipe's
  const arrangement = bed.arrangement
  const blocks = arrangement === undefined ? bedBlocks(bed) : arrangement.blocks.flatMap((b) =>
    b.atS === null || b.endS === null ? [] : [{ start: b.atS, end: b.endS, label: blockLabel(b, arrangement.dropBar) }]
  )
  const pct = (s: number) => `${(s / Math.max(bed.durationS, 0.001)) * 100}%`

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto grid w-full max-w-[680px] gap-5 px-5 pt-5 pb-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play the music with the voice"}
            onClick={toggle}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-fg text-bg outline-none"
          >
            {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
          </button>
          <div className="grid min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{bed.trackTitle}</span>
              {preview ? <span className="inline-flex h-[20px] shrink-0 items-center rounded-chip bg-lemon px-1.5 text-[11px] font-semibold text-lemon-ink">Preview</span> : null}
            </span>
            <span className="text-xs text-fg-2">
              The drop lands at {clockOf(bed.dropAtS)}{bed.dropWordText === null ? "" : <> on “{bed.dropWordText}”</>}
              <Detail><> · {bed.dropAtS.toFixed(2)}s, a bar is {bed.barS.toFixed(2)}s</></Detail>
            </span>
          </div>
          <span className="ml-auto text-xs text-fg-2 tabular-nums">{clockOf(time)} / {clockOf(bed.durationS)}</span>
          {voiceUrl === null ? null : (
            <Button
              variant="ghost"
              aria-pressed={withVoice}
              title={withVoice ? "Hear the music alone" : "Hear the music with the voice"}
              onClick={() => {
                setWithVoice(!withVoice)
                if (voice.current !== null) voice.current.muted = withVoice
              }}
            >
              {withVoice ? <><Mic />With voice</> : <><MicOff />Music only</>}
            </Button>
          )}
        </div>

        <div className="grid gap-1.5">
          <MusicWaveform
            url={bedUrl}
            durationS={bed.durationS}
            dropS={bed.dropAtS}
            time={playing || time > 0 ? time : null}
            onSeek={seek}
            shaded={layout?.reals.map((r) => ({ from: r.start, to: r.end, title: `Real line: ${r.label}` }))}
            bars={180}
            tall
          />
          <div className="relative h-6" aria-label="The parts of the song">
            {blocks.map((b, i) => (
              <span
                key={i}
                title={`${b.label} · ${clockOf(b.start)}–${clockOf(b.end)}`}
                className={cn(
                  "absolute inset-y-0 flex items-center overflow-hidden rounded-[5px] px-1.5 text-[11px] font-medium whitespace-nowrap",
                  "bg-[color-mix(in_srgb,var(--t-music)_var(--seg-tint),var(--bg))] text-[color-mix(in_srgb,var(--t-music)_62%,var(--fg))]"
                )}
                style={{ left: pct(b.start), width: `calc(${pct(b.end - b.start)} - 2px)` }}
              >
                {b.label}
              </span>
            ))}
          </div>
          {layout === null || layout.reals.length === 0 ? null : (
            <span className="text-xs text-fg-2">The orange stretches are real lines; they play in the creator’s voice in the short.</span>
          )}
        </div>

        {onPickWord === null ? null : (
          <span className="-mb-3 text-xs font-medium text-fg">Click the word the part starts on.</span>
        )}
        <p className="m-0 text-[15px] leading-[1.75]">
          {words.map((w, i) => (
            <Fragment key={i}>
              <span
                onClick={() => (onPickWord === null ? seek(shortTimeOf({ pauses }, w.s)) : onPickWord(i))}
                title={[i === bed.dropWord ? "The drop lands here" : null, pins.get(i) ?? null].filter((t) => t !== null).join(" · ") || undefined}
                className={cn(
                  "cursor-pointer rounded-[4px] px-[1px]",
                  (i === bed.dropWord || pins.has(i)) && "shadow-[inset_0_0_0_1px_var(--lemon)]",
                  onPickWord !== null && "hover:bg-lemon hover:text-lemon-ink",
                  i === current ? "bg-lemon text-lemon-ink" : i < current || onPickWord !== null ? "text-fg" : "text-fg-2"
                )}
              >
                {w.w}
              </span>{" "}
            </Fragment>
          ))}
        </p>
      </div>
      <audio ref={music} src={bedUrl} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      {voiceUrl === null ? null : <audio ref={voice} src={voiceUrl} preload="auto" />}
    </div>
  )
}
