import { cn } from "../cn.ts"

// A thin progress bar in lemon. `value` is 0–1, or null while the total isn't known (a short moving stripe).
export function Progress({ value, className, label }: { readonly value: number | null; readonly className?: string; readonly label?: string }) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-ctl", className)}
    >
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full bg-lemon transition-[width] duration-200", pct === null && "w-1/4 animate-pulse")}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </div>
  )
}
