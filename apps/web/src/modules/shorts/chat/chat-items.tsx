import type { Change, ChatCheck, ChatEntry, ChatItem, RunRequest } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { Check, CircleAlert, Pencil, RotateCcw, TriangleAlert, X } from "lucide-react"
import type { ReactNode } from "react"
import { useDetailed } from "../../system/detail.tsx"
import { type EditorStepId, whatToCheck } from "../editor-values.ts"
import { momentOf } from "../render/read-back-values.ts"
import { costText, gateState, providerName, shortModel, stageName, STEP_NAMES } from "./chat-values.ts"

// What the items can do: answer the gate a card shows, and say yes to "Stop and redo".
export interface ChatItemActions {
  readonly pending: RunRequest | null
  readonly busy: boolean
  readonly approve: () => void
  readonly ask: (step: EditorStepId) => void
  readonly editItMyself: (() => void) | null
  // your latest message only: say yes to "Stop and redo"
  readonly stopAndRedo: ((entry: ChatEntry) => void) | null
  // a check with a moment (the render's read-back): watch the rendered short there
  readonly seek?: (at: number) => void
}

const EDITABLE: ReadonlySet<string> = new Set(["script", "shots", "sections", "moments", "thumbnail"])

// A reply's small heading: who said it, and in Detailed mode on which model and what it cost.
function Meta({ who, provider, model, cost, extra }: {
  readonly who: string
  readonly provider?: string | null
  readonly model?: string | null
  readonly cost?: number | null
  readonly extra?: string
}) {
  const detailed = useDetailed()
  const how = [providerName(provider ?? null), shortModel(model ?? null), costText(cost ?? null)].filter((p) => p !== null)
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
      {who}
      {detailed && how.length > 0 ? <span>· {how.join(" · ")}</span> : null}
      {extra === undefined ? null : <span>· {extra}</span>}
    </span>
  )
}

// What the server checked. A check with a moment (the render's read-back) is a warning, not a failure, and its time
// plays the short from there.
function Checks({ checks, onSeek }: { readonly checks: ReadonlyArray<ChatCheck>; readonly onSeek?: ((at: number) => void) | undefined }) {
  if (checks.length === 0) return null
  return (
    <span className="grid gap-[3px] text-xs text-fg-2">
      {checks.map((c, i) => (
        <span key={`${i}-${c.text}`} className="flex items-start gap-1.5">
          {c.ok
            ? <Check className="mt-[2px] size-[13px] shrink-0 text-ok" />
            : c.at === undefined
            ? <X className="mt-[2px] size-[13px] shrink-0 text-danger" />
            : <TriangleAlert className="mt-[2px] size-[13px] shrink-0 text-wait" />}
          <span className="min-w-0 flex-1">{c.text}</span>
          {c.at === undefined ? null : onSeek === undefined
            ? <span className="shrink-0 text-fg-3 tabular-nums">{momentOf(c.at)}</span>
            : (
              <button type="button" onClick={() => onSeek(c.at!)} title={`Watch from ${momentOf(c.at)}`} className="shrink-0 rounded-[5px] bg-ctl px-1 text-fg-2 tabular-nums hover:bg-ctl-hover hover:text-fg">
                {momentOf(c.at)}
              </button>
            )}
        </span>
      ))}
    </span>
  )
}

// A card inside a reply: the change (old struck through, new highlighted) or what the server checked.
function Card({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="grid gap-1.5 rounded-[12px] bg-item px-3 py-2.5 shadow-[0_0_0_1px_var(--line)]">
      <span className="flex items-center gap-1.5 text-xs font-medium text-fg-2"><Pencil className="size-3.5" />{title}</span>
      {children}
    </div>
  )
}

export function ChangeCard({ change, checks }: { readonly change: Change; readonly checks: ReadonlyArray<ChatCheck> }) {
  return (
    <Card title={change.headline}>
      {change.lines.map((line, i) => (
        <span key={i} className="grid gap-0.5">
          {line.label === "" ? null : <span className="text-[11px] text-fg-3">{line.label}</span>}
          {line.old === null ? null : <span className="text-[12.5px] text-fg-3 line-through">{line.old}</span>}
          {line.new === null ? null : <span className="text-[12.5px] text-fg"><mark className="rounded-[3px] bg-lemon-soft px-0.5 text-inherit">{line.new}</mark></span>}
          {line.note === null ? null : <span className="text-xs text-fg-2">{line.note}</span>}
        </span>
      ))}
      <Checks checks={checks} />
    </Card>
  )
}

function Line({ children }: { readonly children: ReactNode }) {
  return <div className="flex justify-center text-[11.5px] text-fg-3"><span className="inline-flex items-center gap-1.5 text-center">{children}</span></div>
}

// The gate card: Approve / Ask for changes / Edit it myself, for the request that's waiting.
function GateCard({ stage, actions }: { readonly stage: EditorStepId; readonly actions: ChatItemActions }) {
  const name = STEP_NAMES[stage]
  return (
    <div className="grid gap-2 rounded-[12px] bg-item px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--wait-dot)_45%,transparent)]">
      <span className="flex items-center gap-1.5 text-xs font-medium text-wait">
        <span aria-hidden className="size-1.5 rounded-full bg-wait-dot" />Waiting for you · {name}
      </span>
      <span className="text-sm text-fg-1">{whatToCheck(stage)}.</span>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="primary" disabled={actions.busy} onClick={actions.approve}><Check />Approve {name.toLowerCase()}</Button>
        <Button disabled={actions.busy} onClick={() => actions.ask(stage)}>Ask for changes</Button>
        {EDITABLE.has(stage) && actions.editItMyself !== null
          ? <Button variant="ghost" disabled={actions.busy} onClick={actions.editItMyself}><Pencil />Edit it myself</Button>
          : null}
      </div>
    </div>
  )
}

const stepOfItem = (item: Extract<ChatItem, { _tag: "Gate" }>): EditorStepId | null => {
  switch (item.stage) {
    case "script":
    case "sections":
    case "moments":
    case "voice":
    case "shots":
    case "render":
    case "thumbnail":
      return item.stage
    case "metadata":
      return "publish"
    default:
      return null
  }
}

// One item of the thread.
export function ChatItemView({ entry, items, actions }: {
  readonly entry: ChatEntry
  readonly items: ReadonlyArray<ChatEntry>
  readonly actions: ChatItemActions
}) {
  const item = entry.item
  switch (item._tag) {
    case "YouSaid": {
      const a = item.action
      return (
        <div className="grid justify-items-end gap-1">
          <div className="max-w-[88%] rounded-[12px_12px_4px_12px] bg-ctl-active px-[11px] py-[7px] text-[13px] text-fg">{item.text}</div>
          {a._tag === "Redo" ? <span className="text-[11.5px] text-fg-3">Redoing from {stageName(a.from)}</span> : null}
          {a._tag === "Action" ? <span className="text-[11.5px] text-fg-3">{a.summary}</span> : null}
          {a._tag === "NotDone" ? (
            <div className="grid justify-items-end gap-1.5">
              <span className="text-right text-[11.5px] text-fg-2">{a.reason}</span>
              {a.offer === null || actions.stopAndRedo === null ? null : (
                <Button size="sm" disabled={actions.busy} onClick={() => actions.stopAndRedo?.(entry)}><RotateCcw />Stop and redo from {stageName(a.offer)}</Button>
              )}
            </div>
          ) : null}
        </div>
      )
    }
    case "AgentMade":
      return (
        <div className="grid gap-1.5 text-[13px] leading-normal">
          <Meta who={`${stageName(item.stage)} agent`} provider={item.provider} model={item.model} cost={item.costUsd} {...(item.earlier ? { extra: "earlier" } : {})} />
          <span className={item.earlier ? "text-fg-2" : "text-fg-1"}>{item.reply ?? item.summary}</span>
          {item.earlier ? null : item.change !== null
            ? <ChangeCard change={item.change} checks={item.checks} />
            : item.checks.length > 0
            ? <Card title="The server checked it"><Checks checks={item.checks} /></Card>
            : null}
        </div>
      )
    case "StepNote":
      return (
        <div className="grid gap-1.5 text-[13px] leading-normal">
          <Meta who={stageName(item.stage)} {...(item.earlier ? { extra: "earlier" } : {})} />
          <span className={item.earlier ? "text-fg-2" : "text-fg-1"}>{item.text}</span>
          {item.earlier ? null : item.change !== null
            ? <ChangeCard change={item.change} checks={item.checks} />
            : item.checks.length > 0
            ? <Card title={item.stage === "render" ? "The server checked the finished short" : "The server checked it"}><Checks checks={item.checks} onSeek={actions.seek} /></Card>
            : null}
        </div>
      )
    case "AgentSaid":
      return (
        <div className="grid gap-1.5 text-[13px] leading-normal">
          <Meta who="Agent" provider={item.provider} model={item.model} cost={item.costUsd} />
          <span className="text-fg-1">{item.text}</span>
        </div>
      )
    case "Gate": {
      const step = stepOfItem(item)
      const state = gateState(entry, items, actions.pending)
      if (state === "open" && step !== null) return <GateCard stage={step} actions={actions} />
      if (state === "replaced") return <Line>Replaced by the draft below</Line>
      return null
    }
    case "Approved":
      return <Line><Check className="size-3.5 text-ok-dot" />You approved the {stageName(item.stage).toLowerCase()}{item.how === "edit" ? " with your edit" : ""}</Line>
    case "Failed":
      return (
        <span className="flex items-start gap-1.5 text-xs text-danger">
          <CircleAlert className="mt-[1px] size-3.5 shrink-0" />{item.stage === null ? "" : `${stageName(item.stage)} stopped: `}{item.message}
        </span>
      )
    case "Earlier":
      return <Line>{item.text}</Line>
  }
}

// A reply on its way: the agent working on a step.
export function WorkingReply({ who, what }: { readonly who: string; readonly what: string | null }) {
  return (
    <div className="grid gap-2" aria-live="polite">
      <span className="text-[11.5px] text-fg-3">{who} · {what ?? "working…"}</span>
      <Skeleton className="h-2.5 w-[88%]" />
      <Skeleton className="h-2.5 w-[72%]" />
      <Skeleton className="h-2.5 w-[54%]" />
    </div>
  )
}
