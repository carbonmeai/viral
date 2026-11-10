import type { Preset, Script } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { Pause, Pencil, Play } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { ClipBadge } from "../clip-badge.tsx"
import { clockOf } from "../editor-values.ts"
import type { GateControls } from "../gate.ts"
import { useClipPlayer } from "../use-clip-player.ts"

const words = (text: string) => text.split(/\s+/).filter((w) => /\w/.test(w)).length

// A text box as tall as its text, so a long line is never partly hidden while you edit it.
function GrowingTextarea({ value, onChange, label }: { readonly value: string; readonly onChange: (value: string) => void; readonly label: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (box === null) return
    box.style.height = "auto"
    box.style.height = `${box.scrollHeight + 2}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={2}
      autoFocus
      className="min-h-[64px] w-full resize-none overflow-hidden rounded-ctl bg-ctl px-2.5 py-2 text-[13.5px] leading-[1.5] text-fg outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--lemon)]"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  )
}

// The script as a document in the Script panel: the headline as it will look, then each line in playing order.
// Narration is what the narrator says (select a line to edit it while the script waits for you); real lines play
// in the creator's own voice (▶ plays them from their video, badged its colour and short name in a short from
// several videos). `editSignal` changing starts editing the selected line (else the first narration line).
export function ScriptStage({ script, preset, videoUrlOf, videos, gate, selected, onSelect, editSignal }: {
  readonly script: Script
  readonly preset: Preset
  // each video's file by position (the first = 0), or null before it's fetched
  readonly videoUrlOf: (source: number) => string | null
  // how many videos the short has
  readonly videos: number
  readonly gate: GateControls
  readonly selected: number | null
  readonly onSelect: (beat: number | null) => void
  readonly editSignal?: number
}) {
  const player = useClipPlayer(videoUrlOf(0))
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const [problems, setProblems] = useState<ReadonlyArray<string>>([])
  const colors = preset.config.headline?.colors ?? null

  const startEdit = (i: number, text: string) => {
    setEditing(i)
    setDraft(text)
    setProblems([])
  }
  const save = (i: number) => {
    const beats = script.beats.map((b, k) => k === i && b._tag === "Narration" ? { ...b, text: draft.trim() } : b)
    void gate.edit({ ...script, beats }).then((refused) => {
      setProblems(refused)
      if (refused.length === 0) setEditing(null)
    })
  }
  useEffect(() => {
    if (editSignal === undefined || editSignal === 0 || gate.request === null) return
    const chosen = selected !== null && script.beats[selected]?._tag === "Narration" ? selected : script.beats.findIndex((b) => b._tag === "Narration")
    const beat = script.beats[chosen]
    if (beat === undefined || beat._tag !== "Narration") return
    onSelect(chosen)
    startEdit(chosen, beat.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new signal starts an edit
  }, [editSignal])

  return (
    <div className="px-2 pb-6">
      {script.headline === null ? null : (
        <div className="pt-1 pb-3 text-center" aria-label="Headline">
          {script.headline.map((line, i) => (
            <div
              key={i}
              className="font-[Anton,Impact,sans-serif] text-[22px] leading-[1.05] tracking-[0.01em] uppercase"
              style={{ color: colors?.[i] ?? (i === 0 ? "#ff2a2a" : "var(--fg)") }}
            >
              {line}
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-0.5">
        {script.beats.map((beat, i) => {
          const isSel = selected === i
          if (beat._tag === "Real") {
            const key = `real-${i}`
            const url = videoUrlOf(beat.source ?? 0)
            return (
              <div key={i} className="grid gap-1 rounded-ctl px-2.5 py-2 hover:bg-panel">
                <span className="flex min-h-5 items-center gap-1.5 text-[11px] tracking-[.03em] text-fg-3">
                  <span className="font-medium text-t-real uppercase">Real line</span>
                  <ClipBadge source={beat.source} videos={videos} />
                  <span className="ml-auto tabular-nums">{clockOf(beat.start)}–{clockOf(beat.end)}</span>
                  <IconButton className="size-5" label={player.playing === key ? "Stop" : "Play this line from the video"} onClick={() => player.play(key, beat.start, beat.end, url)} disabled={url === null}>
                    {player.playing === key ? <Pause /> : <Play />}
                  </IconButton>
                </span>
                <span className="text-[13.5px] leading-[1.5] text-fg-1 italic">“{beat.quote}”</span>
              </div>
            )
          }
          return (
            <div
              key={i}
              onClick={() => onSelect(isSel ? null : i)}
              className={cn("grid cursor-pointer gap-1 rounded-ctl px-2.5 py-2", isSel ? "bg-panel shadow-[inset_0_0_0_1px_var(--lemon)]" : "hover:bg-panel")}
            >
              <span className="flex min-h-5 items-center gap-1.5 text-[11px] tracking-[.03em] text-fg-3">
                <span className="uppercase">Narrator</span>
                <Detail><span className="ml-auto tabular-nums">{words(beat.text)}w</span></Detail>
              </span>
              {editing === i ? (
                <div className="grid gap-2" onClick={(e) => e.stopPropagation()}>
                  <GrowingTextarea label="Narration line" value={draft} onChange={setDraft} />
                  {problems.length === 0 ? null : (
                    <ul className="m-0 grid gap-1 pl-4 text-xs text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    <Button variant="primary" disabled={gate.busy || draft.trim() === ""} onClick={() => save(i)}>Save the line</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-[13.5px] leading-[1.5]">{beat.text}</div>
                  {isSel ? (
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        disabled={gate.request === null}
                        title={gate.request === null ? "Edits go in while the script is waiting for you" : undefined}
                        onClick={() => startEdit(i, beat.text)}
                      >
                        <Pencil />Edit
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
