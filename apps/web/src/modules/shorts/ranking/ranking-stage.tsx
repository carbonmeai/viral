import { IconButton } from "@viral/ui/primitives/button"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { ClipBadge } from "../clip-badge.tsx"
import { clock, type DraftEntry, entrySeconds, listWhilePlaying, rankColor, type RankingDraft, ROLE_NAMES } from "./ranking-values.ts"

// The ranking's overlay as the renderer draws it: the title on top (the accent in red) and the numbered list down the
// left, filled in for the entries played so far.
function Overlay({ draft, rank }: { readonly draft: RankingDraft; readonly rank: number }) {
  const list = listWhilePlaying(draft, rank)
  const count = list.length
  const stroke = "[paint-order:stroke] [-webkit-text-stroke:0.9cqw_#000]"
  return (
    <>
      <div className={`absolute inset-x-[4%] top-[11.5%] text-center font-[Arial_Black,Arial,sans-serif] text-[6.4cqw] leading-none font-black whitespace-nowrap ${stroke}`}>
        <span className="text-white">{draft.title.lead}</span>
        <span style={{ color: "#E8202A" }}>{draft.title.accent}</span>
      </div>
      <div className="absolute top-[21.5%] left-[4%] flex h-[51%] flex-col justify-between">
        {list.map((line) => (
          <div key={line.rank} className={`flex items-center gap-[1.6cqw] font-[Arial_Black,Arial,sans-serif] font-black ${stroke}`}>
            <span className="text-[6cqw] leading-none" style={{ color: rankColor(line.rank, count) }}>{line.rank}.</span>
            {line.revealed ? (
              <span className="flex items-center gap-[1cqw] text-[4cqw] leading-none text-white">
                {line.label}
                <span className="[-webkit-text-stroke:0]">{line.emoji}</span>
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </>
  )
}

// One entry playing as the ranking will show it (9:16): its shots one after another from its video, each in its
// framing (fill: the footage fills the screen; window: a 4:3 window over a blurred copy), with the overlay on top.
function EntryPreview({ draft, entry, stillOf, videoUrl, playing, onEnd, shot, onShot }: {
  readonly draft: RankingDraft
  readonly entry: DraftEntry
  readonly stillOf: (rank: number, k: number) => string | null
  readonly videoUrl: string | null
  readonly playing: boolean
  readonly onEnd: () => void
  readonly shot: number
  readonly onShot: (k: number) => void
}) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const current = entry.shots[shot] ?? entry.shots[0]
  // the callbacks change every render; the effect only follows the shot being played
  const callbacks = useRef({ onEnd, onShot, count: entry.shots.length })
  callbacks.current = { onEnd, onShot, count: entry.shots.length }
  const start = current?.start
  const end = current?.end
  useEffect(() => {
    const el = ref.current
    if (el === null || start === undefined || end === undefined) return
    if (!playing) {
      el.pause()
      return
    }
    el.currentTime = start
    const step = () => {
      if (el.currentTime < end) return
      if (shot + 1 < callbacks.current.count) callbacks.current.onShot(shot + 1)
      else {
        el.pause()
        callbacks.current.onEnd()
      }
    }
    el.addEventListener("timeupdate", step)
    void el.play().catch(() => callbacks.current.onEnd())
    return () => el.removeEventListener("timeupdate", step)
  }, [playing, shot, start, end])

  const still = stillOf(entry.rank, shot)
  const framing = current?.framing ?? "window"
  const cropX = current?.cropX ?? 0.5
  const picture = (className: string) =>
    playing && videoUrl !== null
      ? <video ref={ref} src={videoUrl} className={className} style={{ objectPosition: `${cropX * 100}% 50%` }} playsInline />
      : still === null
      ? <Skeleton className={`${className} rounded-none`} />
      : <img src={still} alt="" className={className} style={{ objectPosition: `${cropX * 100}% 50%` }} />
  return (
    <div className="relative aspect-[9/16] h-full max-h-[560px] max-w-full overflow-hidden rounded-[10px] bg-black [container-type:inline-size]">
      {framing === "window" ? (
        <>
          {still === null ? null : <div className="absolute -inset-8 bg-cover bg-center blur-[18px] brightness-[.62]" style={{ backgroundImage: `url("${still}")` }} />}
          {picture("absolute inset-x-0 top-1/2 aspect-[4/3] w-full -translate-y-1/2 object-cover")}
        </>
      ) : picture("absolute inset-0 size-full object-cover")}
      <Overlay draft={draft} rank={entry.rank} />
    </div>
  )
}

// The Ranking step's stage: the selected entry as the short plays it (its shots, its own sound, the list filling in
// up to it), with the play order to step through.
export function RankingStage({ draft, selected, onSelect, stillOf, videoUrlOf, videos }: {
  readonly draft: RankingDraft
  // the selected entry's rank
  readonly selected: number
  readonly onSelect: (rank: number) => void
  // a shot's image: its planned first frame, or a still at its start
  readonly stillOf: (rank: number, k: number) => string | null
  readonly videoUrlOf: (source: number) => string | null
  readonly videos: number
}) {
  const [playing, setPlaying] = useState(false)
  const [shot, setShot] = useState(0)
  useEffect(() => {
    setPlaying(false)
    setShot(0)
  }, [selected])
  const entry = draft.entries.find((e) => e.rank === selected) ?? draft.entries[0]
  if (entry === undefined) return <div className="grid flex-1 place-items-center text-fg-2">There are no entries.</div>
  const at = draft.order.indexOf(entry.rank)
  const videoUrl = videoUrlOf(entry.source ?? 0)
  const current = entry.shots[shot]
  return (
    <>
      <div className="grid min-h-0 flex-1 place-items-center px-5 py-1.5">
        <EntryPreview
          draft={draft}
          entry={entry}
          stillOf={stillOf}
          videoUrl={videoUrl}
          playing={playing}
          onEnd={() => {
            setPlaying(false)
            setShot(0)
          }}
          shot={shot}
          onShot={setShot}
        />
      </div>
      <div className="flex shrink-0 items-center gap-3.5 px-3.5 pt-1.5 pb-2.5">
        <span className="flex w-[260px] min-w-0 items-center gap-1.5 text-xs text-fg-2">
          <span className="shrink-0">#{entry.rank} · plays {at + 1} of {draft.order.length} · {entrySeconds(entry).toFixed(1)}s</span>
          <ClipBadge source={entry.source} videos={videos} />
        </span>
        <div className="mx-auto flex items-center gap-1">
          <IconButton label="Entry played before" disabled={at <= 0} onClick={() => onSelect(draft.order[at - 1]!)}><ChevronLeft /></IconButton>
          <IconButton
            label={playing ? "Stop" : "Play this entry"}
            disabled={videoUrl === null}
            onClick={() => {
              if (!playing) setShot(0)
              setPlaying(!playing)
            }}
          >
            {playing ? <Pause /> : <Play />}
          </IconButton>
          <IconButton label="Entry played next" disabled={at < 0 || at >= draft.order.length - 1} onClick={() => onSelect(draft.order[at + 1]!)}><ChevronRight /></IconButton>
        </div>
        <span className="flex w-[260px] justify-end gap-1.5 text-xs text-fg-2">
          {entry.shots.map((s, k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setPlaying(false)
                setShot(k)
              }}
              className={k === shot ? "rounded-chip bg-ctl-active px-1.5 text-fg" : "rounded-chip px-1.5 hover:text-fg"}
            >
              {ROLE_NAMES[s.role]}
            </button>
          ))}
          {current === undefined ? null : <Detail><span className="text-fg-3">{clock(current.start)}</span></Detail>}
        </span>
      </div>
    </>
  )
}
