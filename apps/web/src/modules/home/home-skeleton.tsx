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

// A stat card: icon and label, a big number, a sub-line.
export function SkeletonStat() {
  return (
    <div className="flex flex-col gap-2 rounded-panel bg-panel px-4 py-3.5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-12" />
      <Skeleton className="h-2.5 w-32" />
    </div>
  )
}

// Home while it loads: the four stats, the waiting panel, then videos and shorts side by side.
export function HomeSkeleton() {
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }, (_, i) => <SkeletonStat key={i} />)}
      </div>
      <SkeletonPanel rows={2} thumb="tall" />
      <div className="grid grid-cols-2 items-start gap-2">
        <SkeletonPanel rows={2} thumb="wide" />
        <SkeletonPanel rows={3} thumb="tall" />
      </div>
    </div>
  )
}
