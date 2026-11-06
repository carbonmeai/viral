import { Button as BaseButton } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { cn } from "../cn.ts"

// 28px by default, 32px for a page's main actions; the lemon primary is for the one thing to do next.
export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl font-medium outline-none select-none transition-colors disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ctl text-fg hover:bg-ctl-hover",
        primary: "bg-lemon text-lemon-ink hover:brightness-[1.04]",
        ghost: "bg-transparent text-fg-2 hover:bg-ctl hover:text-fg"
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3.5 text-base",
        icon: "size-7 p-0 text-xs"
      }
    },
    defaultVariants: { variant: "default", size: "sm" }
  }
)

export type ButtonProps = BaseButton.Props & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <BaseButton className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export type IconButtonProps = Omit<ButtonProps, "size"> & { readonly label: string; readonly children: React.ReactNode }

// A square 28px button with only an icon; `label` is what screen readers and the tooltip say.
export function IconButton({ label, className, variant = "ghost", ...props }: IconButtonProps) {
  return <Button aria-label={label} title={label} size="icon" variant={variant} className={className} {...props} />
}
