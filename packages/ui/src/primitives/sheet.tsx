import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import type * as React from "react"
import { cn } from "../cn.ts"

export interface SheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  // what screen readers call it ("Create a voice")
  readonly title: string
  readonly children: React.ReactNode
  readonly className?: string
}

// A panel that slides over the right edge of a page, full height, for a tool the page opens without changing (the
// voice generator on Library › Voices). Escape or a click outside closes it.
export function Sheet({ open, onOpenChange, title, children, className }: SheetProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/30" />
        <BaseDialog.Popup
          aria-label={title}
          className={cn("fixed top-0 right-0 bottom-0 z-50 flex w-[360px] max-w-[100vw] flex-col bg-win text-fg shadow-pop outline-none", className)}
        >
          <BaseDialog.Title className="sr-only">{title}</BaseDialog.Title>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
