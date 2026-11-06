import type { Preset } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { IconButton } from "@viral/ui/primitives/button"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import { Detail } from "../../system/detail.tsx"
import { useClipPlayer } from "../use-clip-player.ts"
import { captionOf, SectionPreview } from "./section-preview.tsx"
import { BEATS, clock, type EditSection, framingOf, lengthOf } from "./sections-values.ts"

export type SectionsView = "preview" | "storyboard"

// A section's beat as a small coloured chip.
export function BeatChip({ beat }: { readonly beat: EditSection["beat"] }) {
  const { label, color } = BEATS[beat]
  return (
    <span
      className="inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10.5px] font-medium"
      style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color: `color-mix(in srgb, ${color} 62%, var(--fg))` }}
    >
      {label}
    </span>
  )
}

// The Sections step's stage: the selected section as the short will show it (playable in place), or every
// section as a storyboard in playing order, each with its beat, source times, words and a play button.
export function SectionsStage({ sections, preset, hookText, view, selected, onSelect, stillOf, sourceVideoUrl, playing, onPlaying }: {
  readonly sections: ReadonlyArray<EditSection>
  readonly preset: Preset
  readonly hookText: string | null
  readonly view: SectionsView
  readonly selected: number
  readonly onSelect: (k: number) => void
  // a section's image: its planned frame, or a still at its start
  readonly stillOf: (k: number) => string | null
  readonly sourceVideoUrl: string | null
  // the preview is playing the selected section
  readonly playing: boolean
  readonly onPlaying: (playing: boolean) => void
}) {
  const clips = useClipPlayer(sourceVideoUrl)
  const section = sections[selected]
  if (section === undefined) return <div className="grid flex-1 place-items-center text-fg-2">There are no sections.</div>
  const captions = preset.config.captions
  // the hook card shows over the first section in styles that show a headline
  const card = selected === 0 && preset.config.headline !== null ? hookText : null

  if (view === "preview") {
    return (
      <>
        <div className="grid min-h-0 flex-1 place-items-center px-5 py-1.5">
          <SectionPreview
            still={stillOf(selected)}
            video={sourceVideoUrl === null ? null : { url: sourceVideoUrl, start: section.start, end: section.end, onEnd: () => onPlaying(false) }}
            playing={playing}
            framing={framingOf(section, preset.config)}
            cropX={section.cropX ?? 0.5}
            caption={captionOf(section.text, captions.mode === "chunk" ? captions.maxWords : 3)}
            hookText={card}
            captions={captions}
          />
        </div>
        <div className="flex shrink-0 items-center gap-3.5 px-3.5 pt-1.5 pb-2.5">
          <span className="w-[200px] text-xs text-fg-2">
            Section {selected + 1} of {sections.length} · {lengthOf(section).toFixed(1)}s
            <Detail><span className="text-fg-3"> · {clock(section.start)}</span></Detail>
          </span>
          <div className="mx-auto flex items-center gap-1">
            <IconButton label="Previous section" disabled={selected === 0} onClick={() => onSelect(selected - 1)}><ChevronLeft /></IconButton>
            <IconButton label={playing ? "Stop" : "Play this section"} disabled={sourceVideoUrl === null} onClick={() => onPlaying(!playing)}>
              {playing ? <Pause /> : <Play />}
            </IconButton>
            <IconButton label="Next section" disabled={selected === sections.length - 1} onClick={() => onSelect(selected + 1)}><ChevronRight /></IconButton>
          </div>
          <span className="w-[200px]" />
        </div>
      </>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3.5 pt-1 pb-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
        {sections.map((s, k) => {
          const src = stillOf(k)
          const key = `section-${s.key}`
          return (
            <div
              key={s.key}
              role="button"
              tabIndex={0}
              aria-label={`Section ${k + 1}`}
              onClick={() => onSelect(k)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(k)
              }}
              className={cn(
                "grid cursor-pointer content-start gap-1 rounded-ctl bg-item p-1.5 outline-none hover:bg-item-hover",
                k === selected && "shadow-[inset_0_0_0_1px_var(--lemon)]"
              )}
            >
              <div className="relative aspect-video overflow-hidden rounded-[6px] bg-ctl-active">
                {src === null ? <Skeleton className="size-full rounded-none" /> : <img src={src} alt="" className="size-full object-cover" loading="lazy" />}
                <span className="absolute top-1 left-1 rounded-[4px] bg-black/70 px-1 text-[10px] font-medium text-white">{String(k + 1).padStart(2, "0")}</span>
                <button
                  type="button"
                  aria-label={clips.playing === key ? "Stop" : `Play section ${k + 1}`}
                  disabled={sourceVideoUrl === null}
                  onClick={(e) => {
                    e.stopPropagation()
                    clips.play(key, s.start, s.end)
                  }}
                  className="absolute right-1 bottom-1 grid size-6 place-items-center rounded-full bg-black/70 text-white outline-none hover:bg-black/85 disabled:opacity-40 [&_svg]:size-3"
                >
                  {clips.playing === key ? <Pause /> : <Play />}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <BeatChip beat={s.beat} />
                <span className="text-[11px] text-fg-3">{clock(s.start)}–{clock(s.end)}</span>
              </div>
              <span className="line-clamp-3 text-xs text-fg-1">“{s.text}”</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
