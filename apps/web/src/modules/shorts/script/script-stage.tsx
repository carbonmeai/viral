import type { Preset, Script } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { Pause, Pencil, Play } from "lucide-react"
import { useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { clockOf } from "../editor-values.ts"
import type { GateControls } from "../gate.ts"
import { useClipPlayer } from "../use-clip-player.ts"

const words = (text: string) => text.split(/\s+/).filter((w) => /\w/.test(w)).length

// The script as a document: the headline as it will look, then each line in playing order. Narration is what
// the narrator says; real lines play in the creator's own voice (click ▶ to hear them from the video).
export function ScriptStage({ script, preset, sourceVideoUrl, gate, selected, onSelect }: {
  readonly script: Script
  readonly preset: Preset
  readonly sourceVideoUrl: string | null
  readonly gate: GateControls
  readonly selected: number | null
  readonly onSelect: (beat: number | null) => void
}) {
  const player = useClipPlayer(sourceVideoUrl)
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
            return (
              <div key={i} className="grid grid-cols-[70px_minmax(0,1fr)_auto] items-baseline gap-3.5 rounded-ctl px-3 py-2 hover:bg-ctl">
                <span className="text-[11px] font-medium tracking-[.05em] text-t-real uppercase">Real</span>
                <span className="text-[15px] leading-[1.55] text-fg-2 italic">“{beat.quote}”</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
                  {clockOf(beat.start)}–{clockOf(beat.end)}
                  <IconButton label={player.playing === key ? "Stop" : "Play this line from the video"} onClick={() => player.play(key, beat.start, beat.end)} disabled={sourceVideoUrl === null}>
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
                    <textarea
                      aria-label="Narration line"
                      className="min-h-[64px] w-full resize-y rounded-ctl bg-ctl px-2.5 py-2 text-[15px] leading-[1.5] text-fg outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--lemon)]"
                      value={draft}
                      onChange={(e) => setDraft(e.currentTarget.value)}
                    />
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
