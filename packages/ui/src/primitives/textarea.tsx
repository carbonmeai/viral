import type * as React from "react"
import { cn } from "../cn.ts"

export type TextareaProps = React.ComponentProps<"textarea">

// A multi-line text field on the control fill, like Input; the focus ring is lemon.
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "min-h-[84px] w-full resize-y rounded-ctl bg-ctl px-2.5 py-2 text-base leading-snug text-fg outline-none placeholder:text-fg-3",
        "focus-visible:shadow-[0_0_0_2px_var(--color-lemon-soft),inset_0_0_0_1px_var(--color-lemon)]",
        className
      )}
      {...props}
    />
  )
}
