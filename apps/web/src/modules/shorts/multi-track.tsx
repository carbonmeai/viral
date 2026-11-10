import { SHORT_NAME_MAX } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { IconButton } from "@viral/ui/primitives/button"
import { Menu, MenuItem, MenuNote, MenuSeparator } from "@viral/ui/primitives/menu"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import type { LucideIcon } from "lucide-react"
import { Captions, Eye, EyeOff, Maximize2, Mic, Music, Pause, Pencil, Play, Trophy, AudioLines, ZoomIn, ZoomOut } from "lucide-react"
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { Detail } from "../system/detail.tsx"
import { VideoDot } from "../sets/video-badge.tsx"
import { clockOf } from "./editor-values.ts"
import { type Clip, type ClipTarget, rulerStep, sameTarget, type ShortTimeline, type Track, type TrackKind } from "./track-values.ts"
import { PEAKS_PER_SECOND, useAudioPeaks } from "./use-audio-peaks.ts"

const LABEL_W = 132
const ICONS: Record<Exclude<TrackKind, "video">, LucideIcon> = { entries: Trophy, voice: Mic, sound: AudioLines, music: Music, captions: Captions }

// Lanes a viewer hid, kept in this browser only.
const HIDDEN_KEY = "viral.timeline-hidden"
const readHidden = (): ReadonlySet<string> => {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    return new Set(raw === null ? [] : (JSON.parse(raw) as Array<string>))
  } catch {
    return new Set()
  }
}
const writeHidden = (hidden: ReadonlySet<string>) => {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]))
  } catch {
    // a private window: hiding lasts until the page closes
  }
}

const pct = (seconds: number, total: number) => `${(seconds / total) * 100}%`

// The short's multi-track timeline, display only: a lane per video (its colour dot and short name) with the clips it
// gives the short, then its sound, music and captions pinned below. Play/pause drives the step's player, clicking the
// ruler or a lane seeks it, clicking a clip selects it; zoom stretches the lanes (scroll sideways), Fit shows all.
// A lane's ⋯ hides it (in this browser) and renames a video's short name.
export function MultiTrack({ timeline, head, playing, canPlay, onToggle, onSeek, selected, onSelect, onRename, captionsFrom }: {
  readonly timeline: ShortTimeline
  // the playhead, in the short's seconds
  readonly head: number | null
  readonly playing: boolean
  // the open step has a player to drive
  readonly canPlay: boolean
  readonly onToggle: () => void
  readonly onSeek: (seconds: number) => void
  readonly selected: ClipTarget | null
  readonly onSelect: (clip: Clip) => void
  // renames a video lane's video (null: back to the name made from its title); resolves to a problem, or null
  readonly onRename: (video: number, name: string | null) => Promise<string | null>
  readonly captionsFrom: "render" | "words" | null
}) {
  const [zoom, setZoom] = useState(0)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(readHidden)
  const scroller = useRef<HTMLDivElement>(null)
  const { total } = timeline
  const factor = 1 + (zoom / 100) * 7
  const shown = timeline.tracks.filter((t) => !hidden.has(t.id))
  const hiddenHere = timeline.tracks.filter((t) => hidden.has(t.id))
  const top = shown.filter((t) => !t.pinned)
  const pinned = shown.filter((t) => t.pinned)
  const setHiddenTo = (next: ReadonlySet<string>) => {
    setHidden(next)
    writeHidden(next)
  }

  // keeps the playhead in view while it plays on a zoomed-in timeline
  useEffect(() => {
    const box = scroller.current
    if (box === null || head === null || !playing || factor === 1 || total <= 0) return
    const width = box.scrollWidth - LABEL_W
    const x = LABEL_W + (head / total) * width
    if (x < box.scrollLeft + LABEL_W || x > box.scrollLeft + box.clientWidth - 24) box.scrollLeft = Math.max(0, x - LABEL_W - 40)
  }, [head, playing, factor, total])

  const seekAt = (e: MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(total, ((e.clientX - box.left) / box.width) * total)))
  }

  if (timeline.empty !== null) {
    return <div className="grid h-full min-h-[120px] place-items-center px-6 text-center text-xs text-fg-2">{timeline.empty}</div>
  }
  const step = rulerStep(total / factor)
  const ticks: Array<number> = []
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(t)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-3">
        <div className="flex min-w-0 items-center gap-2 text-[12.5px] tabular-nums">
          <span>{clockOf(head ?? 0)}<span className="text-fg-2"> / {clockOf(total)}</span></span>
          <Detail>
            {captionsFrom === null ? null : (
              <span className="truncate text-xs text-fg-3">· captions {captionsFrom === "render" ? "from the render" : "as they'll be shown"}</span>
            )}
          </Detail>
        </div>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          title={canPlay ? undefined : "Nothing plays on this step yet: open Voice, Music or Render to play"}
          disabled={!canPlay}
          onClick={onToggle}
          className="grid size-[34px] place-items-center rounded-full bg-fg text-bg outline-none disabled:opacity-35"
        >
          {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
        </button>
        <div className="flex items-center justify-end gap-1">
          {hiddenHere.length === 0 ? null : (
            <Menu label="Hidden tracks" trigger={<><EyeOff />{hiddenHere.length} hidden</>} triggerClassName="text-xs font-normal text-fg-2">
              <MenuNote>Hidden in this browser only.</MenuNote>
              {hiddenHere.map((t) => (
                <MenuItem key={t.id} onClick={() => setHiddenTo(new Set([...hidden].filter((id) => id !== t.id)))}><Eye />Show {t.label}</MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onClick={() => setHiddenTo(new Set())}>Show all</MenuItem>
            </Menu>
          )}
          <IconButton label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 20))}><ZoomOut /></IconButton>
          <ZoomSlider value={zoom} onChange={setZoom} />
          <IconButton label="Zoom in" disabled={zoom === 100} onClick={() => setZoom((z) => Math.min(100, z + 20))}><ZoomIn /></IconButton>
          <IconButton label="Fit the whole short" disabled={zoom === 0} onClick={() => setZoom(0)}><Maximize2 /></IconButton>
        </div>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${factor})`, minWidth: "100%" }}>
          <div className="sticky top-0 z-[4] grid bg-bg shadow-[inset_0_-1px_0_var(--line)]" style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr)` }}>
            <div className="sticky left-0 z-[2] h-[22px] bg-bg" />
            <div className="relative h-[22px] cursor-pointer text-[10.5px] text-fg-3" onClick={seekAt} aria-label="Seek">
              {ticks.map((t) => (
                <span key={t} className="absolute top-1 translate-x-[3px] before:absolute before:top-[-4px] before:left-[-3px] before:h-1.5 before:w-px before:bg-line-2" style={{ left: pct(t, total) }}>
                  {clockOf(t)}
                </span>
              ))}
            </div>
          </div>
          <Lanes tracks={top} total={total} selected={selected} onSelect={onSelect} onSeek={seekAt} onHide={(id) => setHiddenTo(new Set([...hidden, id]))} onRename={onRename} />
          {pinned.length === 0 ? null : (
            <div className="sticky bottom-0 z-[3] bg-bg shadow-[0_-1px_0_var(--line)]">
              <Lanes tracks={pinned} total={total} selected={selected} onSelect={onSelect} onSeek={seekAt} onHide={(id) => setHiddenTo(new Set([...hidden, id]))} onRename={onRename} />
            </div>
          )}
          {head === null ? null : (
            <div className="pointer-events-none absolute inset-y-0 z-[5]" style={{ left: LABEL_W, right: 0 }}>
              <div className="absolute inset-y-0 w-[1.5px] bg-fg" style={{ left: pct(Math.min(head, total), total) }}>
                <span className="absolute top-0 -left-[5px] h-[9px] w-[11px] bg-fg [clip-path:polygon(0_0,100%_0,50%_100%)]" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// The zoom: a thin track with its fill and knob, over a native range input (keyboard and screen readers).
function ZoomSlider({ value, onChange }: { readonly value: number; readonly onChange: (value: number) => void }) {
  return (
    <div className="relative mx-1.5 h-7 w-[132px] max-[1281px]:w-[88px]">
      <div aria-hidden className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-ctl-active">
        <div className="h-full rounded-full bg-fg-2" style={{ width: `${value}%` }} />
      </div>
      <span aria-hidden className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg shadow-[0_0_0_2px_var(--bg)]" style={{ left: `${value}%` }} />
      <input
        type="range"
        aria-label="Zoom"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </div>
  )
}

function Lanes({ tracks, total, selected, onSelect, onSeek, onHide, onRename }: {
  readonly tracks: ReadonlyArray<Track>
  readonly total: number
  readonly selected: ClipTarget | null
  readonly onSelect: (clip: Clip) => void
  readonly onSeek: (e: MouseEvent<HTMLElement>) => void
  readonly onHide: (id: string) => void
  readonly onRename: (video: number, name: string | null) => Promise<string | null>
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr)` }}>
      {tracks.map((t) => {
        const short = t.kind === "captions" || t.kind === "entries" || t.clips.length === 0
        return (
          <div key={t.id} className="contents">
            <TrackLabel track={t} short={short} onHide={() => onHide(t.id)} onRename={onRename} />
            <div
              className={cn("relative cursor-pointer shadow-[inset_0_-1px_0_var(--line)]", short ? "h-[26px]" : "h-[34px]")}
              onClick={onSeek}
            >
              {t.note === null ? null : (
                <span
                  className="absolute inset-y-1 flex items-center overflow-hidden rounded-[6px] bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--ctl)_6px_7px)] pl-2 text-[11px] whitespace-nowrap text-fg-3"
                  style={t.noteSpan === null ? { left: 0, right: 0 } : { left: pct(t.noteSpan.start, total), width: pct(t.noteSpan.end - t.noteSpan.start, total) }}
                >
                  {t.note}
                </span>
              )}
              {t.clips.map((clip) => (
                <ClipBlock key={clip.id} clip={clip} total={total} short={short} selected={sameTarget(selected, clip.target)} onSelect={onSelect} />
              ))}
              {t.marks.map((m) => (
                <span key={m.label} className="pointer-events-none absolute inset-y-0 z-[3] w-0.5 bg-lemon" style={{ left: pct(m.at, total) }}>
                  <b className="absolute -top-px left-[3px] rounded-[3px] bg-lemon px-1 text-[9.5px] font-semibold whitespace-nowrap text-lemon-ink">{m.label}</b>
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// A lane's name: a video's colour dot and short name, else the lane's icon and name; ⋯ hides it, and renames a video.
function TrackLabel({ track, short, onHide, onRename }: {
  readonly track: Track
  readonly short: boolean
  readonly onHide: () => void
  readonly onRename: (video: number, name: string | null) => Promise<string | null>
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const Icon = track.kind === "video" ? null : ICONS[track.kind]
  const video = track.video
  const save = () => {
    if (editing === null || video === null) return
    const next = editing.trim()
    setEditing(null)
    if (next === track.label) return
    void onRename(video, next === "" ? null : next).then(setProblem)
  }
  return (
    <div className={cn("sticky left-0 z-[2] flex min-w-0 items-center gap-[7px] bg-bg pr-2 pl-3 text-xs text-fg-1", short ? "h-[26px]" : "h-[34px]")}>
      {video !== null ? <VideoDot index={video} /> : Icon === null ? null : <Icon className="size-[13px] shrink-0 text-fg-3" />}
      {editing !== null ? (
        <input
          autoFocus
          aria-label="Short name"
          value={editing}
          maxLength={SHORT_NAME_MAX}
          onChange={(e) => setEditing(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save()
            if (e.key === "Escape") setEditing(null)
          }}
          className="h-6 min-w-0 flex-1 rounded-[6px] bg-ctl px-1.5 text-xs text-fg outline-none shadow-[inset_0_0_0_1px_var(--lemon)]"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate" title={problem ?? track.label}>{track.label}</span>
      )}
      <Menu label={`${track.label} track`} triggerClassName="size-5 shrink-0 rounded-[5px] text-fg-3 [&_svg]:size-3.5">
        {video !== null ? (
          <>
            <MenuItem onClick={() => setEditing(track.label)}><Pencil />Rename…</MenuItem>
            <MenuNote>The short name shows on every short and set with this video.</MenuNote>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem onClick={onHide}><EyeOff />Hide</MenuItem>
      </Menu>
    </div>
  )
}

// A clip on its lane: its still tiled across (a video's), its stretch of waveform (voice, music), its label; clicking
// it selects it.
function ClipBlock({ clip, total, short, selected, onSelect }: {
  readonly clip: Clip
  readonly total: number
  readonly short: boolean
  readonly selected: boolean
  readonly onSelect: (clip: Clip) => void
}) {
  const media = clip.frame !== null
  return (
    <button
      type="button"
      title={clip.title}
      aria-label={clip.title}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(clip)
      }}
      className={cn(
        "@container absolute flex items-center overflow-hidden rounded-[6px] text-left text-[11px] whitespace-nowrap text-fg outline-none hover:brightness-110",
        short ? "inset-y-[3px]" : "inset-y-1",
        selected && "z-[2]"
      )}
      style={{
        left: pct(clip.start, total),
        width: `max(3px, calc(${pct(clip.end - clip.start, total)} - 2px))`,
        background: clip.wave !== null
          ? `color-mix(in srgb, ${clip.color} 18%, var(--bg))`
          : `color-mix(in srgb, ${clip.color} 22%, var(--bg))`,
        boxShadow: selected ? "inset 0 0 0 1.5px var(--lemon)" : `inset 0 0 0 1px color-mix(in srgb, ${clip.color} 55%, transparent)`
      }}
    >
      {media ? (
        <span
          aria-hidden
          className="absolute inset-0 bg-repeat-x opacity-90"
          style={{ backgroundImage: `url("${clip.frame}")`, backgroundSize: "auto 100%" }}
        />
      ) : null}
      {clip.wave === null ? null : <Wave url={clip.wave.url} from={clip.wave.from} to={clip.wave.to} color={clip.color} />}
      {media && selected ? <span aria-hidden className="absolute inset-0 shadow-[inset_0_0_0_1.5px_var(--lemon)]" /> : null}
      {clip.label === "" ? null : (
        <Label media={media}>{clip.label}</Label>
      )}
    </button>
  )
}

function Label({ media, children }: { readonly media: boolean; readonly children: ReactNode }) {
  return media
    ? <span className="relative z-[1] ml-[3px] min-w-0 truncate rounded-[4px] bg-black/55 px-[5px] text-[10.5px] leading-4 text-white @max-[26px]:hidden">{children}</span>
    : <span className="relative z-[1] min-w-0 truncate px-1.5 font-medium @max-[22px]:hidden">{children}</span>
}

// The stretch of an audio file a clip plays, as bars (decoded once per file).
function Wave({ url, from, to, color }: { readonly url: string; readonly from: number; readonly to: number; readonly color: string }) {
  const peaks = useAudioPeaks(url)
  if (peaks === null) return <Skeleton aria-hidden className="absolute inset-x-1 inset-y-2 rounded-[3px] opacity-60" />
  const slice = peaks.slice(Math.floor(from * PEAKS_PER_SECOND), Math.ceil(to * PEAKS_PER_SECOND))
  if (slice.length === 0) return null
  return (
    <svg aria-hidden viewBox={`0 0 ${slice.length} 100`} preserveAspectRatio="none" className="absolute inset-x-0.5 inset-y-1 h-[calc(100%-8px)] w-[calc(100%-4px)] opacity-40">
      {slice.map((p, i) => {
        const h = Math.max(4, p * 96)
        return <rect key={i} x={i} y={50 - h / 2} width={0.7} height={h} fill={color} />
      })}
    </svg>
  )
}
