import { Skeleton, SkeletonRegion, SkeletonText } from "@viral/ui/primitives/skeleton"
import { useWindowControlsInset } from "../layout/window-controls.ts"
import { EditorFrame } from "./editor-frame.tsx"

// The short's editor while it loads: the real frame (the top bar with its steps, the rail, a panel's rows, the 9:16
// player, the chat column, the timeline's tracks) drawn in grey, so nothing moves when the short arrives.
export function EditorSkeleton() {
  const inset = useWindowControlsInset()
  return (
    <SkeletonRegion label="Loading the short" className="h-full min-h-0">
      <EditorFrame
        sideOpen={false}
        top={
          <header className="drag flex items-center gap-2.5 pr-3 shadow-[inset_0_-1px_0_var(--line)]" style={{ paddingLeft: inset + 12 }}>
            <Skeleton className="size-7" />
            <Skeleton className="h-3.5 w-[180px]" />
            <Skeleton className="h-3 w-[36px]" />
            <span className="mx-auto flex gap-1 rounded-[10px] bg-seg-track p-0.5">
              {[56, 50, 52, 54, 60, 62, 76].map((w, i) => <Skeleton key={i} className="h-[26px]" style={{ width: w }} />)}
            </span>
            <Skeleton className="size-7" />
            <Skeleton className="h-8 w-[108px]" />
          </header>
        }
        rail={
          <div className="flex flex-col items-center gap-3 bg-win py-3 shadow-[inset_-1px_0_0_var(--line)]">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[30px] w-[34px]" />)}
          </div>
        }
        panel={
          <div className="grid content-start gap-4 px-3.5 py-3.5">
            <Skeleton className="h-4 w-[90px]" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid gap-2">
                <Skeleton className="h-3 w-[72px]" />
                <SkeletonText lines={2} />
              </div>
            ))}
          </div>
        }
        player={
          <div className="flex min-h-0 flex-1 flex-col items-center gap-2.5 px-5 pt-3.5 pb-3">
            <Skeleton className="h-9 w-[380px] max-w-full rounded-[10px]" />
            <Skeleton className="aspect-[9/16] h-full max-h-[540px] min-h-0 flex-1 rounded-[12px]" />
            <Skeleton className="h-3 w-[140px]" />
          </div>
        }
        side={
          <div className="grid content-start gap-3.5">
            <div className="flex h-12 items-center gap-2 px-3.5 shadow-[inset_0_-1px_0_var(--line)]"><Skeleton className="size-[22px]" /><Skeleton className="h-3.5 w-[150px]" /></div>
            <div className="grid gap-2 px-3.5"><SkeletonText lines={3} /><Skeleton className="h-[92px] rounded-[12px]" /></div>
          </div>
        }
        timeline={
          <div className="grid gap-1">
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-y-1.5">
              <div />
              <Skeleton className="h-3 w-full opacity-60" />
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="contents">
                  <span className="flex h-9 items-center gap-2"><Skeleton className="size-6" /><Skeleton className="h-3 w-[56px]" /></span>
                  <Skeleton className="h-9 w-full rounded-ctl" />
                </div>
              ))}
            </div>
          </div>
        }
      />
    </SkeletonRegion>
  )
}
