import type * as React from "react"
import { cn } from "../cn.ts"

// A grey shape standing in for content that's loading. Size it like the real thing (className or style), so
// the page keeps its layout and nothing jumps when the data arrives.
export function Skeleton({ className, style }: { readonly className?: string; readonly style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("viral-skeleton block rounded-[6px]", className)} style={style} />
}

// Lines of text: the last one shorter, like a paragraph's end.
export function SkeletonText({ lines = 1, className }: { readonly lines?: number; readonly className?: string }) {
  return (
    <span aria-hidden className={cn("flex flex-col gap-1.5", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: i === lines - 1 && lines > 1 ? "60%" : "100%" }} />
      ))}
    </span>
  )
}

// What a screen reader hears while a skeleton shows.
export function SkeletonRegion({ label, children, className }: {
  readonly label: string
  readonly children: React.ReactNode
  readonly className?: string
}) {
  return (
    <div role="status" aria-busy aria-label={label} className={className}>
      {children}
    </div>
  )
}
