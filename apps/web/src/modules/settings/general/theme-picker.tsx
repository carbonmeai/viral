import { cn } from "@viral/ui/cn"
import type { Theme } from "../../system/preferences.ts"

// Each preview is drawn in its own theme's colours, whatever the app is showing now.
const PALETTES = {
  light: { window: "#ffffff", sidebar: "#f1f1f1", line: "#dcdcdc", strong: "#c4c4c4", lemon: "#b8d400" },
  dark: { window: "#0d0d0d", sidebar: "#1d1d1d", line: "#2f2f2f", strong: "#454545", lemon: "#d9f94a" }
} as const

// A tiny Viral window: the sidebar with its nav lines, then a title, two lines of text and a lemon button.
function MiniWindow({ palette }: { readonly palette: (typeof PALETTES)[keyof typeof PALETTES] }) {
  return (
    <svg viewBox="0 0 96 60" className="block size-full" aria-hidden>
      <rect width="96" height="60" fill={palette.window} />
      <rect width="26" height="60" fill={palette.sidebar} />
      <rect x="6" y="9" width="12" height="3" rx="1.5" fill={palette.strong} />
      <rect x="6" y="17" width="14" height="2" rx="1" fill={palette.line} />
      <rect x="6" y="22" width="11" height="2" rx="1" fill={palette.line} />
      <rect x="6" y="27" width="13" height="2" rx="1" fill={palette.line} />
      <rect x="34" y="10" width="30" height="4" rx="2" fill={palette.strong} />
      <rect x="34" y="19" width="50" height="2.5" rx="1.25" fill={palette.line} />
      <rect x="34" y="25" width="42" height="2.5" rx="1.25" fill={palette.line} />
      <rect x="34" y="38" width="22" height="9" rx="2.5" fill={palette.lemon} />
    </svg>
  )
}

function Preview({ theme }: { readonly theme: Theme }) {
  if (theme !== "system") return <MiniWindow palette={PALETTES[theme]} />
  // System: light on the left, dark on the right, like the Mac's own picker
  return (
    <div className="relative size-full">
      <MiniWindow palette={PALETTES.dark} />
      <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
        <div className="h-full w-[200%]"><MiniWindow palette={PALETTES.light} /></div>
      </div>
    </div>
  )
}

const OPTIONS: ReadonlyArray<{ readonly value: Theme; readonly label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
]

// The theme as three small pictures of the app, the selected one outlined in lemon.
export function ThemePicker({ value, onChange }: { readonly value: Theme; readonly onChange: (theme: Theme) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="flex gap-3">
      {OPTIONS.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className="group flex flex-col items-center gap-1.5 outline-none"
          >
            <span
              className={cn(
                "block h-[60px] w-[96px] overflow-hidden rounded-[10px] ring-offset-2 ring-offset-panel transition-shadow",
                selected ? "ring-2 ring-lemon" : "ring-1 ring-line-2 group-hover:ring-fg-3",
                "group-focus-visible:ring-2 group-focus-visible:ring-ring"
              )}
            >
              <Preview theme={option.value} />
            </span>
            <span className={cn("text-xs", selected ? "font-medium text-fg" : "text-fg-2")}>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
