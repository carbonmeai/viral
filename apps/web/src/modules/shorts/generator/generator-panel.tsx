import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { ChevronRight, Pause, Play } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"

// The generator panels' one shape (Library › Create, the Voice panel's Create, the Thumbnail panel, Library › Voices'
// Create Voice): the preview ("No content", a skeleton while it works, then the result), then Model → Prompt →
// Inputs → Properties, and a footer with what it's expected to cost and Generate.
export function GeneratorShell({ preview, model, prompt, inputs, properties, cost, problem, generate }: {
  readonly preview: ReactNode
  readonly model: ReactNode
  readonly prompt: ReactNode
  readonly inputs?: ReactNode
  readonly properties?: ReactNode
  // "about 600 characters": said before anything is spent
  readonly cost: ReactNode
  readonly problem?: string | null
  readonly generate: { readonly label?: string; readonly disabled: boolean; readonly busy: boolean; readonly onClick: () => void }
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-3 pb-4 [&>*]:shrink-0">
        {preview}
        {model}
        {prompt}
        {inputs === undefined ? null : <Section title="Inputs">{inputs}</Section>}
        {properties === undefined ? null : <Section title="Properties">{properties}</Section>}
      </div>
      <div className="grid shrink-0 gap-1.5 px-3 py-2.5 shadow-[inset_0_1px_0_var(--line)]">
        {problem === null || problem === undefined ? null : <span role="alert" className="text-xs text-danger">{problem}</span>}
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-xs text-fg-2" title={typeof cost === "string" ? cost : undefined}>{cost}</span>
          <Button variant="primary" size="md" className="ml-auto" disabled={generate.disabled || generate.busy} onClick={generate.onClick}>
            {generate.busy ? "Generating…" : generate.label ?? "Generate"}
          </Button>
        </div>
      </div>
    </>
  )
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="grid gap-2 pt-2">
      <span className="text-xs font-medium text-fg-2">{title}</span>
      {children}
    </div>
  )
}

// The preview box: "No content" until something's made, a skeleton while it's made, then the result.
export function GeneratorPreview({ state, children }: { readonly state: "empty" | "working" | "done"; readonly children?: ReactNode }) {
  // a result (or the skeleton) comes into view, wherever the panel was scrolled to
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (state !== "empty") box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [state])
  return (
    <div ref={box} className="grid min-h-[180px] scroll-mt-3 rounded-[12px] bg-panel">
      {state === "empty" ? (
        <span className="m-auto inline-flex h-6 items-center gap-1.5 rounded-full bg-ctl px-2.5 text-xs text-fg-2">
          <span className="size-1.5 rounded-full bg-fg-3" />No content
        </span>
      ) : state === "working" ? (
        <SkeletonRegion label="Generating" className="grid content-center gap-2 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </SkeletonRegion>
      ) : <div className="grid content-start gap-1 p-2">{children}</div>}
    </div>
  )
}

// The Model row: the model's name on the right, a picker (the shared model picker) or a fixed label.
export function ModelRow({ mark, label, picker }: { readonly mark?: string; readonly label?: string; readonly picker?: ReactNode }) {
  return (
    <div className="flex h-10 items-center gap-2 rounded-[10px] bg-panel px-3">
      <span className="text-sm text-fg-2">Model</span>
      <span className="ml-auto flex min-w-0 items-center gap-1.5 text-sm">
        {picker ?? (
          <>
            {mark === undefined ? null : <span className="rounded-[4px] px-1 text-[10px] font-semibold text-fg-2 shadow-[inset_0_0_0_1px_var(--line-2)]">{mark}</span>}
            <span className="truncate">{label}</span>
            <ChevronRight className="size-3.5 text-fg-3" aria-hidden />
          </>
        )}
      </span>
    </div>
  )
}

// The Prompt box: a borderless text area on the panel fill.
export function PromptBox({ label = "Prompt", value, onChange, placeholder }: {
  readonly label?: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder: string
}) {
  return (
    <label className="grid gap-1.5 rounded-[10px] bg-panel px-3 pt-2.5 pb-2 focus-within:shadow-[inset_0_0_0_1px_var(--lemon)]">
      <span className="text-sm text-fg-2">{label}</span>
      <textarea
        value={value}
        rows={3}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="min-h-[64px] w-full resize-none bg-transparent text-sm leading-[1.5] text-fg outline-none placeholder:text-fg-3"
      />
    </label>
  )
}

// One input tile (92px): an icon or a picture, a value chip, and what it is. On, it has the 1.5px lemon outline.
export function InputTile({ icon, value, label, on, onClick, picture }: {
  readonly icon?: ReactNode
  readonly value?: string
  readonly label: string
  readonly on?: boolean
  readonly onClick?: () => void
  readonly picture?: string | null
}) {
  const body = (
    <>
      {picture === undefined || picture === null
        ? <span className="text-fg-2 [&_svg]:size-4">{icon}</span>
        : <img src={picture} alt="" className="h-9 w-full rounded-[6px] object-cover" />}
      {value === undefined ? null : <span className="max-w-full truncate rounded-[5px] bg-ctl px-1.5 text-[11px] text-fg-1">{value}</span>}
      <span className="text-[11.5px] leading-tight text-fg-2">{label}</span>
    </>
  )
  const className = cn(
    "grid min-h-[92px] w-[92px] content-center justify-items-center gap-1 rounded-[10px] bg-panel p-1.5 text-center outline-none",
    on === true && "shadow-[inset_0_0_0_1.5px_var(--lemon)]"
  )
  return onClick === undefined
    ? <div className={className}>{body}</div>
    : <button type="button" aria-pressed={on === true} onClick={onClick} className={cn(className, "cursor-pointer hover:bg-ctl")}>{body}</button>
}

// A property: its name on the left, its control on the right.
export function PropertyRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="text-sm text-fg-1">{label}</span>
      <span className="ml-auto flex items-center gap-1.5">{children}</span>
    </div>
  )
}

// Only one take plays at a time across the generators.
let playingNow: HTMLAudioElement | null = null

// A take you can play: its name, a line under it, and what you can do with it on the right.
export function TakeRow({ url, name, sub, actions, selected }: {
  readonly url: string
  readonly name: string
  readonly sub: string
  readonly actions?: ReactNode
  readonly selected?: boolean
}) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = () => {
    if (audio.current === null) {
      audio.current = new Audio(url)
      audio.current.onended = () => setPlaying(false)
      audio.current.onpause = () => setPlaying(false)
    }
    if (playing) return audio.current.pause()
    if (playingNow !== null && playingNow !== audio.current) playingNow.pause()
    playingNow = audio.current
    void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  return (
    <div className={cn("flex min-h-11 items-center gap-2 rounded-ctl px-1.5", selected === true ? "bg-sel" : "hover:bg-ctl")}>
      <IconButton label={playing ? `Stop ${name}` : `Play ${name}`} onClick={toggle} className={playing ? "text-lemon-fg" : ""}>
        {playing ? <Pause /> : <Play />}
      </IconButton>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm">{name}</span>
        <span className="truncate text-xs text-fg-2">{sub}</span>
      </span>
      {actions}
    </div>
  )
}
