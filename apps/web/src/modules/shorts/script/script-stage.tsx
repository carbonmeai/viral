import type { Preset, Script } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { Pause, Pencil, Play } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
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
      className="min-h-[64px] w-full resize-none overflow-hidden rounded-ctl bg-ctl px-2.5 py-2 text-[15px] leading-[1.5] text-fg outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--lemon)]"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  )
}

// The script as a document: the headline as it will look, then each line in playing order. Narration is what
// the narrator says; real lines play in the creator's own voice (click ▶ to hear them from their video, badged
// its colour and short name in a short from several videos).
export function ScriptStage({ script, preset, videoUrlOf, videos, gate, selected, onSelect }: {
  readonly script: Script
  readonly preset: Preset
  // each video's file by position (the first = 0), or null before it's fetched
  readonly videoUrlOf: (source: number) => string | null
  // how many videos the short has
  readonly videos: number
  readonly gate: GateControls
  readonly selected: number | null
  readonly onSelect: (beat: number | null) => void
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

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pt-4 pb-10">
      {script.headline === null ? null : (
        <div className="pb-4 text-center" aria-label="Headline">
          {script.headline.map((line, i) => (
            <div
              key={i}
              className="font-[Anton,Impact,sans-serif] text-[26px] leading-[1.02] tracking-[0.01em] uppercase"
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
              <div key={i} className="grid grid-cols-[70px_minmax(0,1fr)_auto] items-baseline gap-3.5 rounded-ctl px-3 py-2 hover:bg-ctl">
                <span className="text-[11px] font-medium tracking-[.05em] text-t-real uppercase">Real</span>
                <span className="grid justify-items-start gap-1">
                  <span className="text-[15px] leading-[1.55] text-fg-2 italic">“{beat.quote}”</span>
                  <ClipBadge source={beat.source} videos={videos} />
                </span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
                  {clockOf(beat.start)}–{clockOf(beat.end)}
                  <IconButton label={player.playing === key ? "Stop" : "Play this line from the video"} onClick={() => player.play(key, beat.start, beat.end, url)} disabled={url === null}>
                    {player.playing === key ? <Pause /> : <Play />}
                  </IconButton>
                </span>
              </div>
            )
          }
          return (
            <div
              key={i}
              onClick={() => onSelect(isSel ? null : i)}
              className={cn("grid cursor-pointer grid-cols-[70px_minmax(0,1fr)_auto] items-baseline gap-3.5 rounded-ctl px-3 py-2", isSel ? "bg-sel" : "hover:bg-ctl")}
            >
              <span className="text-[11px] font-medium tracking-[.05em] text-fg-3 uppercase">Narrator</span>
              <div className="min-w-0">
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
                    <div className="text-[15px] leading-[1.55]">{beat.text}</div>
                    {isSel ? (
                      <div className="mt-1.5 flex gap-1" onClick={(e) => e.stopPropagation()}>
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
              <Detail><span className="text-[11.5px] text-fg-3">{words(beat.text)}w</span></Detail>
            </div>
          )
        })}
      </div>
    </div>
  )
}
