import type { StageName } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { ArrowRight, ArrowUp, Check, Pencil, Sparkles, Square } from "lucide-react"
import { type KeyboardEvent, useState } from "react"
import { type EditorStepId, whatToCheck } from "./editor-values.ts"
import { sendBackTargets } from "./render/render-inspector.tsx"
import type { EditorState } from "./use-editor-state.ts"

// Who a note goes to at each step's gate.
const WHO: Record<EditorStepId, string> = {
  script: "Script agent",
  sections: "Sections agent",
  moments: "Ranking agent",
  voice: "Voice step",
  shots: "Shots agent",
  music: "Music",
  render: "Render",
  publish: "Post agent",
  thumbnail: "Thumbnail agent"
}
// Steps whose panel has an editor "Edit it myself" opens.
const EDITABLE: ReadonlySet<EditorStepId> = new Set(["script", "shots", "sections", "moments", "thumbnail"])

// What the agent column's heading says about the run.
const runLine = (e: EditorState) => {
  const current = e.steps.find((s) => s.id === e.current)?.name.toLowerCase() ?? "short"
  if (e.pending !== null) return "waiting for you"
  if (e.liveRun?.status === "running") return `working on the ${current}`
  if (e.ws.metadata !== null) return "published"
  if (e.liveRun?.status === "failed") return "stopped after a problem"
  if (e.liveRun?.status === "cancelled" || e.liveRun?.status === "interrupted") return "stopped"
  return e.liveRun === null ? "not started" : "idle"
}

// What the run is doing now, on whichever step it's on.
const currentWork = (e: EditorState) => {
  const step = e.steps.find((s) => s.id === e.current)
  return step?.stages.map((name) => e.progress.live[name]).find((l) => l !== undefined)?.message ?? null
}

// The chat column, for now: what the run is doing (Stop), the gate card (Approve / Ask for changes / Edit it myself)
// and a message box that works like "Ask for changes" always has: at the open step's gate it sends your note to the
// step's agent, which answers in the same conversation (a render is sent back to its shots, sections or ranking, or to
// its style); otherwise it waits for the run. The agent's own replies come with the chat.
export function EditorSide({ e, onAsk }: { readonly e: EditorState; readonly onAsk: () => void }) {
  const { gate, open, openStep, pending, waitingOn } = e
  const waitingName = e.steps.find((s) => s.id === waitingOn)?.name ?? ""
  // the run is working (not stopped at a gate)
  const running = e.liveRun?.status === "running" && pending === null
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2.5 pl-3.5 shadow-[inset_0_-1px_0_var(--line)]">
        <span className="grid size-[22px] shrink-0 place-items-center rounded-[7px] bg-lemon text-lemon-ink"><Sparkles className="size-[13px]" /></span>
        <b className="font-semibold">Agent</b>
        <span className="min-w-0 truncate text-xs text-fg-2">· {runLine(e)}</span>
        {running ? (
          <Button className="ml-auto" variant="ghost" disabled={e.busy} onClick={() => void e.stopRun().then(() => e.refresh())}>
            <Square className="size-3 fill-current" />Stop
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-3.5 pt-3.5 pb-2">
        {running ? (
          <div className="grid gap-2" aria-live="polite">
            <span className="text-xs text-fg-2">{e.steps.find((s) => s.id === e.current)?.name} · {currentWork(e) ?? "working…"}</span>
            <Skeleton className="h-3 w-[88%]" />
            <Skeleton className="h-3 w-[72%]" />
            <Skeleton className="h-3 w-[54%]" />
          </div>
        ) : null}
        {pending !== null && waitingOn !== null ? (
          <div className="grid gap-2 rounded-[12px] bg-item px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--wait-dot)_45%,transparent)]">
            <span className="flex items-center gap-1.5 text-xs font-medium text-wait">
              <span aria-hidden className="size-1.5 rounded-full bg-wait-dot" />Waiting for you · {waitingName}
            </span>
            <span className="text-sm text-fg-1">{whatToCheck(waitingOn)}.</span>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="primary" disabled={e.busy} onClick={e.approvePending}><Check />Approve {waitingName.toLowerCase()}</Button>
              <Button
                disabled={e.busy}
                onClick={() => {
                  if (open !== waitingOn) e.onStep(waitingOn)
                  onAsk()
                }}
              >
                Ask for changes
              </Button>
              {EDITABLE.has(waitingOn) ? <Button variant="ghost" disabled={e.busy} onClick={e.editItMyself}><Pencil />Edit it myself</Button> : null}
            </div>
          </div>
        ) : null}
        {pending === null && e.state === "done" && e.current !== open && e.states.get(e.current) !== "done" ? (
          <div className="grid justify-items-start gap-2">
            <span className="flex items-center gap-1.5 text-xs text-fg-2"><Check className="size-3.5 text-ok-dot" />You approved the {openStep.name.toLowerCase()}</span>
            <Button onClick={() => e.onStep(e.current)}>Go to {e.steps.find((s) => s.id === e.current)?.name}<ArrowRight /></Button>
          </div>
        ) : null}
        {e.error === null ? null : <span className="text-xs text-danger">{e.error}</span>}
      </div>
      <Composer e={e} />
    </>
  )
}

// The message box at the bottom of the chat column. It sends at the open step's gate only, as "Ask for changes" does
// (Enter sends, Shift+Enter is a new line); a render can be sent back to its shots (sections, ranking) or its style.
function Composer({ e }: { readonly e: EditorState }) {
  const { gate, open, openStep } = e
  const targets = sendBackTargets(e.ws.project.format)
  const [to, setTo] = useState<StageName>(targets[0]!.to)
  const [note, setNote] = useState("")
  const waiting = gate.request !== null
  const target = targets.find((t) => t.to === to) ?? targets[0]!
  const send = () => {
    const text = note.trim()
    if (!waiting || gate.busy || text === "") return
    if (open === "render") gate.sendBack(text, to)
    else gate.ask(text)
    setNote("")
  }
  const keys = (k: KeyboardEvent<HTMLTextAreaElement>) => {
    if (k.key === "Enter" && !k.shiftKey) {
      k.preventDefault()
      send()
    }
  }
  return (
    <div className="mx-3 mb-3 grid shrink-0 gap-2">
      {open === "render" && waiting ? (
        <>
          <Segmented<StageName> label="Send back to" full value={to} onChange={setTo} options={targets.map((t) => ({ value: t.to, label: `Back to ${t.label}` }))} />
          <span className="px-0.5 text-xs text-fg-2">{target.help}</span>
        </>
      ) : null}
      <div className={cn("grid gap-1.5 rounded-[14px] bg-item px-2.5 pt-2.5 pb-2 shadow-[0_0_0_1px_var(--line-2)]", waiting && "focus-within:shadow-[0_0_0_1px_var(--lemon),0_0_0_4px_var(--lemon-soft)]")}>
        <textarea
          ref={e.composer}
          aria-label={`Note to the ${WHO[open].toLowerCase()}`}
          rows={2}
          disabled={!waiting}
          value={note}
          onChange={(x) => setNote(x.currentTarget.value)}
          onKeyDown={keys}
          placeholder={waiting ? (open === "render" ? "What should change?" : "Tell the agent what to change…") : "Notes go in while this step is waiting for you."}
          className="min-h-10 w-full resize-none bg-transparent px-0.5 text-base text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-xs text-fg-2">
            {!waiting ? `${openStep.name} isn't waiting for you` : open === "render" ? `Sends the render back to ${target.label}` : `${WHO[open]} · answers in the same conversation`}
          </span>
          <IconButton
            className="ml-auto size-7 rounded-full"
            variant={waiting && note.trim() !== "" ? "primary" : "default"}
            label="Send"
            disabled={!waiting || gate.busy || note.trim() === ""}
            onClick={send}
          >
            <ArrowUp />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
