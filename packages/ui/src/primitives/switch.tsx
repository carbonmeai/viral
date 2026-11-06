import { Switch as BaseSwitch } from "@base-ui/react/switch"
import { cn } from "../cn.ts"

export interface SwitchProps {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly label: string
  readonly className?: string
}

// On or off, lemon when on.
export function Switch({ checked, onChange, label, className }: SwitchProps) {
  return (
    <BaseSwitch.Root
      aria-label={label}
      checked={checked}
      onCheckedChange={onChange}
      className={cn("relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer rounded-full bg-ctl-active p-0.5 transition-colors data-[checked]:bg-lemon", className)}
    >
      <BaseSwitch.Thumb className="block size-3.5 rounded-full bg-white shadow-chip transition-transform data-[checked]:translate-x-3.5" />
    </BaseSwitch.Root>
  )
}
