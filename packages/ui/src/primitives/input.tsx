import { Input as BaseInput } from "@base-ui/react/input"
import type * as React from "react"
import { cn } from "../cn.ts"

export type InputProps = React.ComponentProps<typeof BaseInput>

// A 28px text field on the control fill; the focus ring is lemon.
export function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      className={cn(
        "h-7 min-w-0 rounded-ctl bg-ctl px-2.5 text-base text-fg outline-none placeholder:text-fg-3",
        "focus-visible:shadow-[0_0_0_2px_var(--color-lemon-soft),inset_0_0_0_1px_var(--color-lemon)]",
        className
      )}
      {...props}
    />
  )
}
