import { Skeleton } from "@viral/ui/primitives/skeleton"

// A row in a panel: a thumbnail, a title and a sub-line, and a status on the right.
export function SkeletonRow({ thumb = "wide" }: { readonly thumb?: "wide" | "tall" | "none" }) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-ctl bg-item px-3 py-2">
      {thumb === "none" ? null : <Skeleton className={thumb === "wide" ? "h-9 w-16 shrink-0" : "h-9 w-[22px] shrink-0"} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-[45%]" />
        <Skeleton className="h-2.5 w-[28%]" />
      </div>
      <Skeleton className="h-5 w-16 shrink-0" />
    </div>
  )
}

// A panel with its title and some rows.
export function SkeletonPanel({ rows, thumb, title = true }: {
  readonly rows: number
  readonly thumb?: "wide" | "tall" | "none"
  readonly title?: boolean
}) {
  return (
    <section className="rounded-panel bg-panel px-4 pt-3.5 pb-4">
      {title ? <div className="mb-2 flex min-h-7 items-center"><Skeleton className="h-3.5 w-28" /></div> : null}
      <div className="flex flex-col gap-[3px]">
        {Array.from({ length: rows }, (_, i) => <SkeletonRow key={i} {...(thumb === undefined ? {} : { thumb })} />)}
      </div>
    </section>
  )
}

// Home's recents while they load: the tabs, the search row, then rows with a picture, two lines, a status and a time.
export function RecentsSkeleton() {
  return (
    <div>
      <div className="mb-2.5 flex h-8 items-center gap-4 px-2.5">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="mb-2 h-8 w-full" />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="grid min-h-14 grid-cols-[minmax(0,1fr)_190px_112px_28px] items-center gap-3 px-2 py-1.5 shadow-[0_1px_0_var(--line)]">
          <span className="flex items-center gap-2.5">
            <Skeleton className="h-10 w-[26px] shrink-0" />
            <span className="grid flex-1 gap-1.5"><Skeleton className="h-3 w-[50%]" /><Skeleton className="h-2.5 w-[30%]" /></span>
          </span>
          <Skeleton className="h-[22px] w-32" />
          <Skeleton className="h-2.5 w-16" />
          <span />
        </div>
      ))}
    </div>
  )
}
