import { Skeleton } from "@viral/ui/primitives/skeleton"

// A video's page while it loads (the page header already says "Video"): the description line, the tabs, the
// story strip, and the three proposals.
export function VideoSkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="-mt-1 h-3 w-[64%]" />
      <div className="flex w-fit gap-1 rounded-[10px] bg-seg-track p-0.5">
        {[70, 82, 52, 76, 64].map((w, i) => <Skeleton key={i} className="h-7" style={{ width: w }} />)}
      </div>
      <section className="rounded-panel bg-panel px-4 pt-3.5 pb-4">
        <Skeleton className="mb-3 h-3.5 w-40" />
        <Skeleton className="h-7 w-full" />
        <div className="mt-2 flex justify-between">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-2.5 w-8" />)}</div>
      </section>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <section key={i} className="flex flex-col gap-2.5 rounded-panel bg-panel p-4">
            <Skeleton className="aspect-video w-full rounded-[8px]" />
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-4 w-[85%]" />
            <Skeleton className="h-3 w-[70%]" />
            <div className="flex flex-col gap-2 pt-1">
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} className="flex items-center gap-3"><Skeleton className="h-2.5 w-20" /><Skeleton className="h-1.5 flex-1" /></div>
              ))}
            </div>
            <Skeleton className="mt-1 h-7 w-32" />
          </section>
        ))}
      </div>
    </div>
  )
}
