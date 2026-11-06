import { Skeleton, SkeletonRegion, SkeletonText } from "@viral/ui/primitives/skeleton"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"
import { ServerState } from "../home/server-state.tsx"

// The data once it's there; while it loads, the page's own layout in skeletons; if the server can't be
// reached, ServerState says so.
export function Loaded<A, E>({ result, skeleton, children, onRetry }: {
  readonly result: AsyncResult.AsyncResult<A, E>
  readonly skeleton: ReactNode
  readonly children: (data: A) => ReactNode
  readonly onRetry?: () => void
}) {
  if (Option.isNone(AsyncResult.value(result)) && !AsyncResult.isFailure(result)) return <>{skeleton}</>
  return (
    <ServerState result={result} {...(onRetry === undefined ? {} : { onRetry })}>
      {children}
    </ServerState>
  )
}

// A panel of rows while it loads: a title, then rows with a thumbnail, two lines and an action.
export function RowsSkeleton({ label, rows, media }: { readonly label: string; readonly rows: number; readonly media?: ReactNode }) {
  return (
    <SkeletonRegion label={label} className="rounded-panel bg-panel px-4 pt-3.5 pb-4">
      <Skeleton className="mb-3.5 h-4 w-28" />
      <div className="flex flex-col gap-[3px]">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-12 items-center gap-3 rounded-[8px] bg-item px-3 py-2">
            {media ?? <Skeleton className="size-8 rounded-[6px]" />}
            <SkeletonText lines={2} className="w-56" />
            <Skeleton className="ml-auto h-7 w-20 rounded-ctl" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}
