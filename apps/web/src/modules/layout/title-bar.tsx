// The desktop title bar: only what you're looking at. The sidebar shows where it lives, so there's no path.
// It's also where the window is dragged from.
export function TitleBar({ title }: { readonly title: string }) {
  return (
    <header className="drag flex h-11 shrink-0 items-center gap-3 pr-4 pl-5 shadow-[inset_0_-1px_0_var(--line)]">
      <b className="truncate font-semibold">{title}</b>
    </header>
  )
}
