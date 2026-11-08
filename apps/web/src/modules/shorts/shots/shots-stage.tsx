import type { Preset, ShotPlan } from "@viral/contracts"
import { IconButton } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Detail } from "../../system/detail.tsx"
import { ClipBadge } from "../clip-badge.tsx"
import { ShotPreview } from "./shot-preview.tsx"
import { highlightWords, mmss, type ShotDraft, shotWith, storyboardOrder } from "./shots-values.ts"

export type ShotsView = "preview" | "storyboard"

// The Shots step's stage: the selected shot as the short will show it, or every shot as a storyboard in playing
// order with the real lines where they cut in. Clicking a tile selects that shot.
export function ShotsStage({ plan, draft, preset, headline, view, selected, onSelect, frameOf, realFrameOf, candidate, videos }: {
  readonly plan: ShotPlan
  readonly draft: ShotDraft
  readonly preset: Preset
  // the script's headline, pinned in styles that show one
  readonly headline: readonly [string, string] | null
  readonly view: ShotsView
  readonly selected: number
  readonly onSelect: (k: number) => void
  // the image for a shot (its planned frame, or the still you picked for it)
  readonly frameOf: (k: number) => string | null
  readonly realFrameOf: (kind: "insert" | "outro", index: number) => string | null
  // a still being tried in the frame picker, shown on the stage instead of the shot's own frame
  readonly candidate: string | null
  // how many videos the short has (badges on each shot and real line when more than one)
  readonly videos: number
}) {
  const highlights = highlightWords(plan)
  const shot = plan.shots[selected]
  if (shot === undefined) return null
  const now = shotWith(shot, draft.get(selected))

  if (view === "preview") {
    const word = shot.wordText.replace(/[.,!?;:]+$/, "")
    return (
      <>
        <div className="grid min-h-0 flex-1 place-items-center px-5 py-1.5">
          <ShotPreview
            src={candidate ?? frameOf(selected)}
            framing={preset.config.framing}
            fit={now.fit ?? false}
            cropX={now.cropX ?? 0.5}
            word={word}
            highlighted={highlights.has(word.toLowerCase())}
            captions={preset.config.captions}
            headline={headline === null || preset.config.headline === null ? null : { lines: headline, style: preset.config.headline }}
          />
        </div>
        <div className="flex shrink-0 items-center gap-3.5 px-3.5 pt-1.5 pb-2.5">
          <span className="w-[160px] text-xs text-fg-2">
            Shot {selected + 1} of {plan.shots.length}
            {videos < 2 ? null : <ClipBadge source={now.source} videos={videos} className="ml-1.5 align-middle" />}
            <Detail><span className="text-fg-3"> · {mmss(now.src)}</span></Detail>
          </span>
          <div className="mx-auto flex items-center gap-1">
            <IconButton label="Previous shot" disabled={selected === 0} onClick={() => onSelect(selected - 1)}><ChevronLeft /></IconButton>
            <IconButton label="Next shot" disabled={selected === plan.shots.length - 1} onClick={() => onSelect(selected + 1)}><ChevronRight /></IconButton>
          </div>
          <span className="w-[160px]" />
        </div>
      </>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3.5 pt-1 pb-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">
        {storyboardOrder(plan).map((item) => {
          if (item._tag === "Real") {
            const clip = item.kind === "insert" ? plan.inserts[item.index]! : plan.outro[item.index]!
            const src = realFrameOf(item.kind, item.index)
            return (
              <div key={`${item.kind}-${item.index}`} className="grid content-start gap-1 rounded-ctl bg-item p-1.5">
                <div className="relative aspect-video overflow-hidden rounded-[6px] bg-ctl-active">
                  {src === null ? null : <img src={src} alt="" className="size-full object-cover" loading="lazy" />}
                  <span className="absolute top-1 left-1 flex items-center gap-1">
                    <span className="rounded-[4px] bg-black/70 px-1 text-[10px] font-medium text-t-real">{item.kind === "insert" ? "REAL" : "END"}</span>
                    {videos < 2 ? null : <span className="rounded-[5px] bg-black/70"><ClipBadge source={clip.source} videos={videos} /></span>}
                  </span>
                </div>
                <span className="line-clamp-2 text-xs text-t-real italic">“{clip.quote}”</span>
                <span className="truncate text-[11px] text-fg-3">{item.kind === "insert" ? "the creator’s own voice" : "plays after the narration"}</span>
              </div>
            )
          }
          const s = plan.shots[item.k]!
          const word = s.wordText.replace(/[.,!?;:]+$/, "")
          const changed = draft.has(item.k)
          return (
            <button
              key={`shot-${item.k}`}
              type="button"
              onClick={() => onSelect(item.k)}
              className={cn(
                "grid content-start gap-1 rounded-ctl bg-item p-1.5 text-left outline-none hover:bg-item-hover",
                item.k === selected && "shadow-[inset_0_0_0_1px_var(--lemon)]"
              )}
            >
              <div className="relative aspect-video overflow-hidden rounded-[6px] bg-ctl-active">
                {frameOf(item.k) === null ? null : <img src={frameOf(item.k)!} alt={s.note} className="size-full object-cover" loading="lazy" />}
                <span className="absolute top-1 left-1 flex items-center gap-1">
                  <span className="rounded-[4px] bg-black/70 px-1 text-[10px] font-medium text-white">{String(item.k + 1).padStart(2, "0")}</span>
                  {videos < 2 ? null : <span className="rounded-[5px] bg-black/70"><ClipBadge source={shotWith(s, draft.get(item.k)).source} videos={videos} /></span>}
                </span>
                {changed ? <span className="absolute top-1 right-1 rounded-[4px] bg-lemon px-1 text-[10px] font-medium text-lemon-ink">edited</span> : null}
              </div>
              <span className="truncate text-xs">
                “{highlights.has(word.toLowerCase()) ? <span className="text-lemon-fg">{word}</span> : word}…”
              </span>
              <span className="truncate text-[11px] text-fg-3">{s.note}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
