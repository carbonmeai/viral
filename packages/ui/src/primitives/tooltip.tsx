import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import type * as React from "react"

export interface TooltipProps {
  readonly content: React.ReactNode
  // the element the tooltip describes; rendered as the trigger
  readonly children: React.ReactElement
}

export const TooltipProvider = BaseTooltip.Provider

// A small label that appears on hover, in the popover surface.
export function Tooltip({ content, children }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={6}>
          <BaseTooltip.Popup className="rounded-ctl bg-pop px-2 py-1 text-xs text-fg shadow-pop">{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
