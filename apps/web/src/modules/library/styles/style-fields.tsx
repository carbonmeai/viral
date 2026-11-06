import { Input } from "@viral/ui/primitives/input"

// A colour: the system picker as a 28px swatch, plus its hex code to type or paste.
export function ColourField({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (hex: string) => void }) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="color"
        aria-label={label}
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.currentTarget.value.toUpperCase())}
        className="size-7 cursor-pointer rounded-ctl border-0 bg-ctl p-1"
      />
      <Input aria-label={`${label} hex`} className="w-[84px] font-mono text-xs" value={value} onChange={(e) => onChange(e.currentTarget.value.trim())} />
    </span>
  )
}

// A number on a slider with its value next to it.
export function RangeField({ label, value, min, max, step, format, onChange }: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly format: (value: number) => string
  readonly onChange: (value: number) => void
}) {
  return (
    <span className="flex items-center gap-2.5">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="w-36 cursor-pointer accent-[var(--color-lemon)]"
      />
      <span className="w-12 text-right font-mono text-xs text-fg-1">{format(value)}</span>
    </span>
  )
}
