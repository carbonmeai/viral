import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"

// A panel beside the player: its 48px heading (an optional way back, the title, an action on the right), an optional
// row under it (a panel's views or tabs), then its content, which scrolls on its own and may end in a footer.
export function Panel({ title, back, action, under, children }: {
  readonly title: ReactNode
  // a crumb back to where this view was opened from ("Library ›")
  readonly back?: { readonly label: string; readonly onClick: () => void }
  readonly action?: ReactNode
  readonly under?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 pr-3 pl-3.5">
        {back === undefined ? null : (
          <button type="button" onClick={back.onClick} className="inline-flex items-center gap-1 rounded-ctl text-fg-2 outline-none hover:text-fg focus-visible:shadow-[0_0_0_1px_var(--lemon)]">
            {back.label}<ChevronRight className="size-3 text-fg-3" />
          </button>
        )}
        <b className="min-w-0 truncate font-semibold">{title}</b>
        {action === undefined ? null : <span className="ml-auto flex shrink-0 items-center gap-1.5">{action}</span>}
      </div>
      {under === undefined ? null : <div className="shrink-0 px-3 pb-2.5">{under}</div>}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </>
  )
}

// A panel's scrolling content when the panel lays it out itself.
export function PanelBody({ children }: { readonly children: ReactNode }) {
  return <div className="grid min-h-0 flex-1 content-start gap-4 overflow-auto px-3 pb-4">{children}</div>
}

// A muted line in a panel: what's shown here when there's nothing yet, and why.
export function PanelNote({ children }: { readonly children: ReactNode }) {
  return <div className="px-3.5 py-2 text-sm text-fg-2">{children}</div>
}
