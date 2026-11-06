import type { ReactNode } from "react"

// The desktop title bar: only what you're looking at. The sidebar shows where it lives, so there's no path.
// It's also where the window is dragged from.
// `children`: a small state on the right (e.g. what the short is waiting on); it isn't draggable.
export function TitleBar({ title, children }: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <header className="drag flex h-11 shrink-0 items-center gap-3 pr-4 pl-5 shadow-[inset_0_-1px_0_var(--line)]">
      <b className="truncate font-semibold" title={title}>{title}</b>
      {children === undefined ? null : <div className="no-drag ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  )
}
