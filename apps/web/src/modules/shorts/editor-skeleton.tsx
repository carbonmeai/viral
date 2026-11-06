import { Skeleton, SkeletonRegion, SkeletonText } from "@viral/ui/primitives/skeleton"
import { EditorFrame } from "./editor-frame.tsx"

// The short's editor while it loads: the real frame (the step bar, the 9:16 stage, the inspector's tabs and rows,
// the timeline's tracks) drawn in grey, so nothing moves when the short arrives.
export function EditorSkeleton() {
  return (
    <SkeletonRegion label="Loading the short" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 pr-4 pl-5 shadow-[inset_0_-1px_0_var(--line)]">
        <Skeleton className="h-3.5 w-[260px]" />
        <Skeleton className="ml-auto h-[22px] w-[110px]" />
      </header>
      <EditorFrame
        bar={
          <>
            <span className="flex gap-1 rounded-track bg-seg-track p-0.5">
              {[64, 58, 56, 64, 66, 82].map((w, i) => <Skeleton key={i} className="h-7" style={{ width: w }} />)}
            </span>
            <span className="ml-auto flex gap-2">
              <Skeleton className="h-8 w-[136px]" />
              <Skeleton className="h-8 w-[156px]" />
            </span>
          </>
        }
        stage={
          <>
            <div className="flex shrink-0 items-center gap-2 px-3.5 py-2.5">
              <Skeleton className="h-7 w-[188px]" />
              <Skeleton className="ml-auto h-[22px] w-[96px]" />
            </div>
            <div className="grid min-h-0 flex-1 place-items-center px-5 py-1.5">
              <Skeleton className="aspect-[9/16] h-full max-h-[540px] rounded-[10px]" />
            </div>
            <div className="flex shrink-0 justify-center gap-1 px-3.5 pt-1.5 pb-2.5">
              <Skeleton className="size-7" />
              <Skeleton className="size-7" />
            </div>
          </>
        }
        inspector={
          <>
            <div className="flex shrink-0 gap-1 px-3 py-2 shadow-[inset_0_-1px_0_var(--line)]">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="size-7" />)}
            </div>
            <div className="grid content-start gap-5 p-4">
              <div className="grid gap-2">
                <Skeleton className="h-3 w-[88px]" />
                <Skeleton className="aspect-video w-full rounded-[8px]" />
                <SkeletonText lines={2} />
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid gap-2">
                  <Skeleton className="h-3 w-[72px]" />
                  <Skeleton className="h-7 w-full" />
                </div>
              ))}
            </div>
          </>
        }
        timeline={
          <div className="grid gap-1">
            <div className="flex justify-end pb-1"><Skeleton className="h-3 w-[120px]" /></div>
            <div className="grid grid-cols-[112px_minmax(700px,1fr)] items-center gap-y-1.5">
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
