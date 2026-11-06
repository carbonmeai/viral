import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { cn } from "../cn.ts"

// A short state label: "Story mapped", "Shots", "Transcribing". Colour only says what kind of state it is.
export const statusVariants = cva(
  "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-chip px-2 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-ctl text-fg-1",
        ok: "bg-[color-mix(in_srgb,var(--ok-dot)_12%,transparent)] text-ok",
        wait: "bg-[color-mix(in_srgb,var(--wait-dot)_13%,transparent)] text-wait",
        run: "bg-[color-mix(in_srgb,var(--run-dot)_13%,transparent)] text-run"
      }
    },
    defaultVariants: { tone: "neutral" }
  }
)

export function Status({ tone, className, ...props }: React.ComponentProps<"span"> & VariantProps<typeof statusVariants>) {
  return <span className={cn(statusVariants({ tone }), className)} {...props} />
}

const dotTone = { neutral: "bg-fg-3", ok: "bg-ok-dot", wait: "bg-wait-dot", run: "bg-run-dot" } as const

export function Dot({ tone = "neutral", className }: { readonly tone?: keyof typeof dotTone; readonly className?: string }) {
  return <span aria-hidden className={cn("inline-block size-[7px] shrink-0 rounded-full", dotTone[tone], className)} />
}

// A count in lemon: "Waiting for you 3".
export function Count({ children, className }: { readonly children: React.ReactNode; readonly className?: string }) {
  return <span className={cn("rounded-chip bg-lemon px-1.5 text-2xs font-semibold leading-[18px] text-lemon-ink", className)}>{children}</span>
}
