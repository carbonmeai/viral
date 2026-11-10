import { cn } from "@viral/ui/cn"
import { Captions, FileText, FolderOpen, type LucideIcon, Mic, Music, Palette, Scissors, Trophy, Type } from "lucide-react"
import type { PanelId, RailItem } from "./editor-values.ts"

const ICONS: Partial<Record<PanelId, LucideIcon>> = {
  library: FolderOpen,
  script: Type,
  ranks: Trophy,
  sections: Scissors,
  captions: Captions,
  voice: Mic,
  music: Music,
  style: Palette,
  post: FileText
}

// The icon rail on the editor's left: each item opens its panel, without changing the step. The open panel's item
// sits on the selection fill; a dot marks where the step waiting for you lives.
export function EditorRail({ items, panel, dot, onPanel }: {
  readonly items: ReadonlyArray<RailItem>
  readonly panel: PanelId
  readonly dot: PanelId | null
  readonly onPanel: (panel: PanelId) => void
}) {
  return (
    <nav aria-label="Panels" className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto bg-win py-2.5 shadow-[inset_-1px_0_0_var(--line)]">
      {items.map((item) => {
        const Icon = ICONS[item.id] ?? FolderOpen
        const on = item.id === panel
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            onClick={() => onPanel(item.id)}
            className={cn(
              "group relative flex w-14 flex-col items-center gap-[3px] rounded-[10px] pt-[5px] pb-1.5 text-[10.5px] text-fg-2 outline-none hover:text-fg focus-visible:shadow-[0_0_0_1px_var(--lemon)]",
              on && "font-medium text-fg"
            )}
          >
            <span className={cn("grid h-[30px] w-[34px] place-items-center rounded-ctl", on ? "bg-sel shadow-[inset_0_0_0_1px_var(--line-2)]" : "group-hover:bg-ctl")}>
              <Icon className="size-4" />
            </span>
            {item.label}
            {dot === item.id ? <span aria-label="waiting for you" className="absolute top-0.5 right-1.5 size-[7px] rounded-full bg-wait-dot" /> : null}
          </button>
        )
      })}
    </nav>
  )
}
