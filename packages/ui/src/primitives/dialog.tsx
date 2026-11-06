import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import type * as React from "react"
import { cn } from "../cn.ts"

export interface DialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: React.ReactNode
  // one muted line under the title
  readonly description?: React.ReactNode
  readonly children?: React.ReactNode
  // the buttons, right-aligned at the bottom
  readonly footer?: React.ReactNode
  readonly className?: string
}

// A small centred dialog on the popover surface, over a dimmed page. Escape or a click outside closes it.
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <BaseDialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 gap-3",
            "rounded-panel bg-pop p-4 text-fg shadow-pop outline-none",
            className
          )}
        >
          <div className="grid gap-1">
            <BaseDialog.Title className="m-0 text-base font-semibold">{title}</BaseDialog.Title>
            {description === undefined ? null : <BaseDialog.Description className="m-0 text-sm text-fg-2">{description}</BaseDialog.Description>}
          </div>
          {children}
          {footer === undefined ? null : <div className="flex items-center justify-end gap-2 pt-1">{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
