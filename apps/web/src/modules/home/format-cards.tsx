import { cn } from "@viral/ui/cn"
import { Film } from "lucide-react"
import { FORMAT_CARDS, type FormatHint } from "./prompt-values.ts"

// The four ways a short can be made, under the box. Picking one is a hint: it sets "Made as", the default length
// (a ranking starts at Up to 3 min) and the box's prompt, and the set page highlights the matching suggestion.
// Each card shows a frame from one of your own shorts made that way, when there is one.
export function FormatCards({ picked, art, onPick }: {
  readonly picked: FormatHint | null
  readonly art: Partial<Record<FormatHint, ReadonlyArray<string>>>
  readonly onPick: (id: FormatHint) => void
}) {
  return (
    <div className="mt-10 mb-11 grid grid-cols-4 gap-2 max-[1100px]:grid-cols-2">
      {FORMAT_CARDS.map((card) => {
        const pictures = art[card.id] ?? []
        return (
          <button
            key={card.id}
            type="button"
            aria-pressed={picked === card.id}
            onClick={() => onPick(card.id)}
            className={cn(
              "flex min-w-0 cursor-pointer items-stretch gap-2.5 rounded-panel bg-panel p-2 text-left hover:bg-ctl-hover",
              picked === card.id && "shadow-[inset_0_0_0_1px_var(--lemon)]"
            )}
          >
            <span className="relative grid aspect-[9/14] w-[54px] shrink-0 place-items-center overflow-hidden rounded-ctl bg-ctl-active text-fg-3">
              {pictures.length === 0
                ? <Film className="size-4" />
                : pictures.length === 1
                ? <img src={pictures[0]} alt="" className="size-full object-cover" loading="lazy" />
                : (
                  <span className="absolute inset-0 grid grid-rows-2">
                    {pictures.slice(0, 2).map((src) => <img key={src} src={src} alt="" className="size-full object-cover" loading="lazy" />)}
                  </span>
                )}
            </span>
            <span className="flex min-w-0 flex-col gap-[3px] py-0.5">
              <b className="text-base font-semibold">{card.title}</b>
              <span className="text-xs leading-[1.35] text-fg-2">{card.line}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
