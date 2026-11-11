import { CLOSING_ASK, type Preset, type Script } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { Pause, Pencil, Play } from "lucide-react"
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { ClipBadge } from "../clip-badge.tsx"
import { clockOf } from "../editor-values.ts"
import type { GateControls } from "../gate.ts"
import { useClipPlayer } from "../use-clip-player.ts"
import { countdownOf, entryHeading, rankCardColor } from "./countdown-values.ts"

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
// several videos). The closing question (the style's comment question) comes last: the narrator says it with the ask
// after it, over the end card; its words are outside the word count. `editSignal` changing starts editing the selected
// line (else the first narration line). A narrated ranking (`countdown`: its entries) groups the lines by rank: the hook,
// then each entry under its "#N" card with its video and about how long it runs; #1's real take at the end is the reveal.
export function ScriptStage({ script, preset, videoUrlOf, videos, gate, selected, onSelect, editSignal, countdown = null, videoName }: {
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
  // a narrated ranking: how many entries it counts down (one per video); null = not a ranking
  readonly countdown?: number | null
  // a video's short name by position, for the entries' headings
  readonly videoName?: (source: number) => string
}) {
  const groups = countdown === null ? null : countdownOf(script, countdown)
  const lastNarration = script.beats.findLastIndex((b) => b._tag === "Narration")
  const headingAt = (i: number): ReactNode => {
    if (groups === null) return null
    if (i === 0 && groups.hookEnd > 0) return <GroupHeading label="Hook" detail="before the countdown, teasing #1" />
    const entry = groups.entries.find((e) => e.start === i)
    if (entry === undefined) return null
    return <GroupHeading rank={entry.rank} label={entryHeading(entry, videoName ?? ((v) => `V${v + 1}`))} />
  }
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
  // a narrated line right after a real line can be skipped (the real line says it): voiced, but jumped over
  const skippable = (i: number) => script.beats[i - 1]?._tag === "Real" &&
    script.beats[i + 1]?._tag === "Narration" && (script.beats[i + 1] as { readonly skipped?: boolean }).skipped !== true
  const setSkipped = (i: number, skipped: boolean) => {
    const beats = script.beats.map((b, k) => k !== i || b._tag !== "Narration" ? b : skipped ? { ...b, skipped: true } : { _tag: "Narration" as const, text: b.text })
    void gate.edit({ ...script, beats }).then(setProblems)
  }
  const save = (i: number) => {
    const beats = script.beats.map((b, k) =>
      k !== i ? b : b._tag === "Narration" ? { ...b, text: draft.trim() } : b._tag === "Cta" ? { ...b, question: draft.trim() } : b
    )
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
        {script.beats.map((beat, i) => <Fragment key={i}>{headingAt(i)}{renderBeat(beat, i)}</Fragment>)}
      </div>
    </div>
  )

  function renderBeat(beat: Script["beats"][number], i: number): ReactNode {
    const isSel = selected === i
    if (beat._tag === "Real") {
      const key = `real-${i}`
      const url = videoUrlOf(beat.source ?? 0)
      return (
        <div key={i} className="grid gap-1 rounded-ctl px-2.5 py-2 hover:bg-panel">
          <span className="flex min-h-5 items-center gap-1.5 text-[11px] tracking-[.03em] text-fg-3">
            <span className="font-medium text-t-real uppercase">{groups !== null && i > lastNarration ? "Reveal · real take" : "Real line"}</span>
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
    if (beat._tag === "Cta") {
      return (
        <div
          key={i}
          onClick={() => onSelect(isSel ? null : i)}
          className={cn("mt-2 grid cursor-pointer gap-1 rounded-ctl px-2.5 py-2", isSel ? "bg-panel shadow-[inset_0_0_0_1px_var(--lemon)]" : "hover:bg-panel")}
        >
          <span className="flex min-h-5 items-center gap-1.5 text-[11px] tracking-[.03em] whitespace-nowrap text-fg-3">
            <span className="font-medium text-t-cap uppercase">Closing question</span>
            <span className="ml-auto" title="After the payoff, over a held last frame: the question in yellow and a red SUBSCRIBE button. Not counted in the words.">end card</span>
          </span>
          {editing === i ? (
            <div className="grid gap-2" onClick={(e) => e.stopPropagation()}>
              <GrowingTextarea label="Closing question" value={draft} onChange={setDraft} />
              <span className="text-xs text-fg-3">The narrator adds “{CLOSING_ASK}”</span>
              {problems.length === 0 ? null : (
                <ul className="m-0 grid gap-1 pl-4 text-xs text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                <Button variant="primary" disabled={gate.busy || draft.trim() === ""} onClick={() => save(i)}>Save the question</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-[13.5px] leading-[1.5]">
                {beat.question} <span className="text-fg-3">{CLOSING_ASK}</span>
              </div>
              {isSel ? (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    disabled={gate.request === null}
                    title={gate.request === null ? "Edits go in while the script is waiting for you" : undefined}
                    onClick={() => startEdit(i, beat.question)}
                  >
                    <Pencil />Edit
                  </Button>
                </div>
              ) : null}
              {isSel && problems.length > 0 ? (
                <ul className="m-0 grid gap-1 pl-4 text-xs text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              ) : null}
            </>
          )}
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
          {beat.skipped === true ? <span title="Voiced, but the short jumps over it: the real line before it says it">· skipped, the real line says it</span> : null}
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
            <div className={cn("text-[13.5px] leading-[1.5]", beat.skipped === true && "text-fg-3")}>{beat.text}</div>
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
                {beat.skipped === true || skippable(i) ? (
                  <Button
                    variant="ghost"
                    disabled={gate.request === null || gate.busy}
                    title={beat.skipped === true
                      ? "The narrator says this line after the real line (no new take needed)"
                      : "The real line before it says the same: keep it in the take, but jump over it"}
                    onClick={() => setSkipped(i, beat.skipped !== true)}
                  >
                    {beat.skipped === true ? "Narrator says it" : "Let the real line say it"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {isSel && problems.length > 0 ? (
              <ul className="m-0 grid gap-1 pl-4 text-xs text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            ) : null}
          </>
        )}
      </div>
    )
  }
}

// A heading above a group of lines in a narrated ranking: the entry's "#N" in its card colour, or the hook.
function GroupHeading({ rank, label, detail }: { readonly rank?: number; readonly label: string; readonly detail?: string }) {
  return (
    <div className="mt-3 flex min-w-0 items-baseline gap-2 overflow-hidden px-2.5 pb-0.5 first:mt-0">
      {rank === undefined ? null : (
        <span className="font-[Anton,Impact,sans-serif] text-[20px] leading-none" style={{ color: rankCardColor(rank) }} aria-hidden>#{rank}</span>
      )}
      <span className="min-w-0 truncate text-[11px] font-medium tracking-[.03em] text-fg-2 uppercase">{rank === undefined ? label : label.replace(/^#\d+ · /, "")}</span>
      {detail === undefined ? null : <span className="truncate text-[11px] text-fg-3">{detail}</span>}
    </div>
  )
}
