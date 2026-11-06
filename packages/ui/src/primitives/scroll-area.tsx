import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area"
import type * as React from "react"
import { cn } from "../cn.ts"

// A scrolling region with a thin scrollbar that shows on hover, so pages and the sidebar scroll the same way.
export function ScrollArea({ className, children }: { readonly className?: string; readonly children: React.ReactNode }) {
  return (
    <BaseScrollArea.Root className={cn("relative min-h-0 overflow-hidden", className)}>
      <BaseScrollArea.Viewport className="size-full overscroll-contain">{children}</BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar className="flex w-2 justify-center p-0.5 opacity-0 transition-opacity data-[hovering]:opacity-100 data-[scrolling]:opacity-100">
        <BaseScrollArea.Thumb className="w-1 rounded-full bg-ctl-active" />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  )
}
