import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ChatEntry, ChatIntentAction } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Menu, MenuItem } from "@viral/ui/primitives/menu"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowUp, Copy, History, MessageSquare, Sparkles, Square } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { appSettingsAtom } from "../../settings/settings-api.ts"
import { useDetailed } from "../../system/detail.tsx"
import type { EditorStepId } from "../editor-values.ts"
import { useShortVideos } from "../short-videos.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { chatAtom, doChatAction, sendChat } from "./chat-api.ts"
import { ChatItemView, WorkingReply } from "./chat-items.tsx"
import { type Chip, chipsFor, composerState, emptyThread, plainText, STEP_NAMES, whoAnswers, workingOn } from "./chat-values.ts"

// What the column's heading says about the run.
const runLine = (e: EditorState) => {
  const current = e.steps.find((s) => s.id === e.current)?.name.toLowerCase() ?? "short"
  if (e.pending !== null) return "waiting for you"
  if (e.liveRun?.status === "running") return `working on the ${current}`
  if (e.ws.metadata !== null) return "published"
  if (e.liveRun?.status === "failed") return "stopped after a problem"
  if (e.liveRun?.status === "cancelled" || e.liveRun?.status === "interrupted") return "stopped"
  return e.liveRun === null ? "not started" : "idle"
}

// The agent chat: one running conversation per short (decision 3). The server writes it (each agent's reply with
// its change card and checks, gates, approvals); your messages go to the open step (decision 9), the gate card and
// the waiting bar above the player answer the same request (decision 1), and the chips are typed actions.
export function ChatColumn({ e, onAsk }: { readonly e: EditorState; readonly onAsk: () => void }) {
  const projectId = e.ws.project.id
  const result = useAtomValue(chatAtom(projectId))
  const thread = Option.getOrElse(AsyncResult.value(result), () => emptyThread)
  const send = useAtomSet(sendChat, { mode: "promise" })
  const act = useAtomSet(doChatAction, { mode: "promise" })
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const running = e.liveRun?.status === "running" && e.pending === null
  const working = workingOn(running, e.current, e.states)
  const live = e.steps.find((s) => s.id === e.current)?.stages.map((name) => e.progress.live[name]).find((l) => l !== undefined)?.message ?? null

  // the newest item stays in view as the thread grows
  const toLatest = () => body.current?.scrollTo({ top: body.current.scrollHeight, behavior: "smooth" })
  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight })
  }, [thread.items.length, working])

  const done = (p: Promise<unknown>) => {
    setSending(true)
    setProblem(null)
    return p
      .then(() => e.refresh())
      .catch((error: unknown) => setProblem(messageOf(error)))
      .finally(() => setSending(false))
  }
  const sendText = (text: string, stopRun = false) =>
    done(send({ payload: { projectId, step: e.open, text, ...(stopRun ? { stopRun } : {}) } }))
  const runAction = (label: string, action: ChatIntentAction, stopRun = false) =>
    done(act({ payload: { projectId, step: e.open, label, action, ...(stopRun ? { stopRun } : {}) } }))
  const stopAndRedo = (entry: ChatEntry) => {
    const item = entry.item
    if (item._tag !== "YouSaid" || item.action._tag !== "NotDone") return
    void (item.action.retry !== null
      ? done(act({ payload: { projectId, step: item.step, label: item.text, action: item.action.retry, stopRun: true } }))
      : done(send({ payload: { projectId, step: item.step, text: item.text, stopRun: true } })))
  }
  const ask = (step: EditorStepId) => {
    if (e.open !== step) e.onStep(step)
    onAsk()
  }
  // only your latest message can still be acted on ("Stop and redo")
  const lastYou = thread.items.findLast((i) => i.item._tag === "YouSaid")?.seq ?? -1

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1.5 pr-2.5 pl-3.5 shadow-[inset_0_-1px_0_var(--line)]">
        <span className="grid size-[22px] shrink-0 place-items-center rounded-[7px] bg-lemon text-lemon-ink"><Sparkles className="size-[13px]" /></span>
        <b className="font-semibold">Agent</b>
        <span className="min-w-0 truncate text-xs text-fg-2">· {runLine(e)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {running ? (
            <Button variant="ghost" disabled={e.busy} onClick={() => void e.stopRun().then(() => e.refresh())}>
              <Square className="size-3 fill-current" />Stop
            </Button>
          ) : null}
          <IconButton label="Jump to the latest" onClick={toLatest}><History /></IconButton>
          <Menu label="More for the chat">
            <MenuItem onClick={() => void navigator.clipboard.writeText(thread.items.map((i) => plainText(i.item)).join("\n"))}>
              <Copy />Copy the conversation
            </MenuItem>
          </Menu>
        </span>
      </div>
      <div ref={body} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-3.5 pt-3.5 pb-2">
        {!thread.loaded ? (
          <SkeletonRegion label="Loading the conversation" className="grid gap-3">
            <Skeleton className="h-2.5 w-[60%]" />
            <Skeleton className="h-2.5 w-[88%]" />
            <Skeleton className="h-16 w-full rounded-[12px]" />
          </SkeletonRegion>
        ) : thread.items.length === 0 && working === null ? (
          <div className="my-auto grid justify-items-center gap-2 px-4 text-center">
            <span className="grid size-10 place-items-center rounded-[10px] bg-ctl text-fg-2"><MessageSquare className="size-5" /></span>
            <span className="font-medium">Direct the agent</span>
            <span className="text-sm text-fg-2">Say what you want changed. The agent knows this short, its videos and your library.</span>
          </div>
        ) : null}
        {thread.items.map((entry) => (
          <ChatItemView
            key={entry.id}
            entry={entry}
            items={thread.items}
            actions={{
              pending: e.pending,
              busy: e.busy || sending,
              approve: e.approvePending,
              ask,
              editItMyself: e.editItMyself,
              stopAndRedo: entry.seq === lastYou ? stopAndRedo : null
            }}
          />
        ))}
        {working === null ? null : <WorkingReply who={`${STEP_NAMES[working]} agent`} what={live} />}
        {sending ? <WorkingReply who="Agent" what="reading your message…" /> : null}
        {problem === null && e.error === null ? null : <span className="text-xs text-danger">{problem ?? e.error}</span>}
      </div>
      <Chips e={e} disabled={sending} onSend={(text) => void sendText(text)} onAct={(label, action) => void runAction(label, action)} />
      <Composer e={e} sending={sending} onSend={(text) => sendText(text)} />
    </>
  )
}

const messageOf = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    if (error._tag === "ChatFailed" && "message" in error && typeof error.message === "string") return error.message
    if (error._tag === "ProjectNotFound") return "This short is gone."
  }
  return "Couldn't send that. Is the server running?"
}

// The suggestion chips for the open step: words for its agent, an action as it is, or a panel opened.
function Chips({ e, disabled, onSend, onAct }: {
  readonly e: EditorState
  readonly disabled: boolean
  readonly onSend: (text: string) => void
  readonly onAct: (label: string, action: ChatIntentAction) => void
}) {
  const videos = useShortVideos()
  const own = e.ws.voiceId
  const other = e.voices.find((v) => v.voiceId !== own && v.category === "premade") ?? e.voices.find((v) => v.voiceId !== own) ?? null
  const chips = chipsFor(e.open, {
    format: e.ws.project.format,
    videos: videos.names,
    otherVoice: other === null ? null : { id: other.voiceId, name: other.name.split(" - ")[0]! },
    hasSong: e.ws.project.musicTrackId !== null,
    entries: e.ws.rankingPlan?.plan.entries.length ?? 0
  })
  const { enabled } = composerState(e.open, e.states.get(e.open), e.waitingOn === e.open && e.pending !== null)
  if (chips.length === 0 || !enabled) return null
  const run = (chip: Chip) => {
    if ("send" in chip) onSend(chip.send)
    else if ("act" in chip) onAct(chip.label, chip.act)
    else if (chip.open === "music-picker") {
      e.setPanel("music")
      e.setPickingSong(true)
    } else e.setPanel("style")
  }
  return (
    <div className="flex shrink-0 flex-wrap gap-1.5 px-3.5 pb-2">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          disabled={disabled}
          onClick={() => run(chip)}
          className="h-7 rounded-[8px] bg-item px-2.5 text-xs whitespace-nowrap text-fg-1 shadow-[0_0_0_1px_var(--line)] outline-none hover:bg-item-hover hover:text-fg focus-visible:shadow-[0_0_0_1px_var(--lemon)] disabled:opacity-50"
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}

// The message box: Enter sends, Shift+Enter is a new line. The footer says who answers on the open step (Detailed:
// the provider and model, and whether it's on your plan).
function Composer({ e, sending, onSend }: { readonly e: EditorState; readonly sending: boolean; readonly onSend: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState("")
  const detailed = useDetailed()
  const settings = Option.getOrNull(AsyncResult.value(useAtomValue(appSettingsAtom)))
  const { enabled, why } = composerState(e.open, e.states.get(e.open), e.waitingOn === e.open && e.pending !== null)
  const who = whoAnswers(e.open, settings)
  const send = () => {
    const words = text.trim()
    if (!enabled || sending || words === "") return
    void onSend(words).then(() => setText(""))
  }
  const keys = (k: KeyboardEvent<HTMLTextAreaElement>) => {
    if (k.key === "Enter" && !k.shiftKey) {
      k.preventDefault()
      send()
    }
  }
  return (
    <div className="mx-3 mb-3 shrink-0">
      <div className={cn("grid gap-1.5 rounded-[14px] bg-item px-2.5 pt-2.5 pb-2 shadow-[0_0_0_1px_var(--line-2)]", enabled && "focus-within:shadow-[0_0_0_1px_var(--lemon),0_0_0_4px_var(--lemon-soft)]")}>
        <textarea
          ref={e.composer}
          aria-label={`Message to the ${who.who.toLowerCase()}`}
          rows={2}
          disabled={!enabled}
          value={text}
          onChange={(x) => setText(x.currentTarget.value)}
          onKeyDown={keys}
          placeholder={enabled ? "Tell the agent what to change…" : why ?? ""}
          className="min-h-10 w-full resize-none bg-transparent px-0.5 text-base text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-none disabled:cursor-not-allowed"
        />
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-xs text-fg-2">
            {detailed ? `${who.who} · ${who.how} · ${who.billing}` : who.who}
          </span>
          <IconButton
            className="ml-auto size-7 shrink-0 rounded-full"
            variant={enabled && text.trim() !== "" ? "primary" : "default"}
            label="Send"
            disabled={!enabled || sending || text.trim() === ""}
            onClick={send}
          >
            <ArrowUp />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
