import type { ShortWorkspace, StageRun } from "@viral/contracts"
import { useNavigate } from "@tanstack/react-router"
import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Menu, MenuItem } from "@viral/ui/primitives/menu"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ExternalLink, ListOrdered, MessageSquare, Shuffle, Trash2, Trophy } from "lucide-react"
import { useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { AskBox } from "../ask-box.tsx"
import { ClipBadge } from "../clip-badge.tsx"
import { Facts, InspectorBlock } from "../editor-frame.tsx"
import type { GateControls } from "../gate.ts"
import { type InspectorTab, InspectorTabs } from "../inspector-tabs.tsx"
import { nameOf, useShortVideos } from "../short-videos.tsx"
import { FramePicker, type PickedFrame, type PickerVideo } from "../shots/frame-picker.tsx"
import { StepDetails } from "../step-details.tsx"
import {
  byRank,
  clock,
  entrySeconds,
  FRAMING_NAMES,
  moveInOrder,
  moveRank,
  moveShotTo,
  nudgeShot,
  plainWarning,
  rankInk,
  type RankingDraft,
  removeEntry,
  ROLE_NAMES,
  setEntry,
  shuffleAgain,
  wordsIn
} from "./ranking-values.ts"

export type RankingTab = "ranks" | "order" | "ask"
const TABS: ReadonlyArray<InspectorTab<RankingTab>> = [
  { id: "ranks", label: "The ranks", icon: Trophy },
  { id: "order", label: "Title and play order", icon: ListOrdered },
  { id: "ask", label: "Ask the agent", icon: MessageSquare }
]

export interface RankingInspectorProps {
  readonly draft: RankingDraft
  // a change to keep as it is (labels, order), or one the server snaps to whole sentences first (`snap`)
  readonly onDraft: (next: RankingDraft, snap?: boolean) => void
  readonly changes: number
  readonly source: NonNullable<ShortWorkspace["rankingSource"]>
  readonly warnings: ReadonlyArray<string>
  readonly selected: number
  readonly onSelect: (rank: number) => void
  readonly stillOf: (rank: number, k: number) => string | null
  readonly videos: ReadonlyArray<PickerVideo>
  readonly stillUrl: (path: string, source: number) => string
  // the ranking's length as last checked (snapped)
  readonly durationS: number
  readonly problems: ReadonlyArray<string>
  readonly checking: boolean
  readonly onRevert: () => void
  readonly onSend: () => void
  readonly stages: ReadonlyArray<StageRun>
  readonly gate: GateControls
  readonly tab: RankingTab
  readonly onTab: (tab: RankingTab) => void
}

// The Ranking step's inspector: the ranks (#1 first) with each entry's video, label, emoji and before / care / after
// frames, the selected entry's shots (another moment from the frame picker, edges nudged in Detailed view, every
// change snapped to whole sentences by the server), the title and play order, and asking the agent. Changes collect
// as one edit, checked by the server before it goes to the gate.
export function RankingInspector(props: RankingInspectorProps) {
  const { draft, gate, tab, onTab } = props
  return (
    <>
      <InspectorTabs tabs={TABS} open={tab} onOpen={onTab} />
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto p-4">
        {tab === "ask" ? (
          <AskBox gate={gate} who="moments agent" placeholder="e.g. #3's after shows the cat before its shave; use the fluffy cat at the end." />
        ) : tab === "order" ? (
          <OrderTab {...props} />
        ) : draft.entries.length === 0 ? (
          <span className="text-sm text-fg-2">There are no entries.</span>
        ) : (
          <RanksTab {...props} />
        )}
      </div>
      {props.changes === 0 && props.problems.length === 0 ? null : (
        <div className="grid shrink-0 gap-2 px-4 py-2.5 shadow-[inset_0_1px_0_var(--line)]">
          {props.problems.length === 0 ? null : (
            <ul className="m-0 grid max-h-[120px] gap-1 overflow-auto pl-4 text-xs text-danger">{props.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm">{props.changes} {props.changes === 1 ? "change" : "changes"}{props.checking ? " · checking…" : ""}</span>
            <Button className="ml-auto" variant="ghost" disabled={gate.busy} onClick={props.onRevert}>Revert</Button>
            <Button variant="primary" disabled={gate.request === null || gate.busy || props.checking || props.changes === 0} onClick={props.onSend}>Send edit</Button>
          </div>
        </div>
      )}
    </>
  )
}

// −0.5s · the time · +0.5s for one edge of a shot; the server snaps it to whole sentences.
function EdgeNudge({ label, at, disabled, onNudge }: { readonly label: string; readonly at: number; readonly disabled: boolean; readonly onNudge: (d: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-10 text-xs text-fg-2">{label}</span>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onNudge(-0.5)}>−0.5s</Button>
      <span className="mx-auto font-mono text-sm tabular-nums">{clock(at)}</span>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onNudge(0.5)}>+0.5s</Button>
    </div>
  )
}

function RanksTab(props: RankingInspectorProps) {
  const { draft, onDraft, source, selected, onSelect, stillOf, gate } = props
  const named = useShortVideos()
  const navigate = useNavigate()
  const editable = gate.request !== null
  const several = source.videos.length > 1
  const ranked = byRank(draft)
  const entry = ranked.find((e) => e.rank === selected) ?? ranked[0]!
  const [picking, setPicking] = useState<number | null>(null)
  const [candidate, setCandidate] = useState<PickedFrame | null>(null)
  const video = source.videos[entry.source ?? 0]
  const total = props.durationS
  const over = total > source.maxSeconds
  return (
    <>
      <InspectorBlock title="Length" action={<span className={over ? "font-normal text-danger" : "font-normal text-fg"}>{total.toFixed(1)}s of {source.maxSeconds.toFixed(0)}s</span>}>
        <div className="relative h-1.5 rounded-full bg-ctl">
          <div className={over ? "absolute inset-y-0 left-0 rounded-full bg-danger" : "absolute inset-y-0 left-0 rounded-full bg-lemon"} style={{ width: `${Math.min(100, (total / source.maxSeconds) * 100)}%` }} />
        </div>
      </InspectorBlock>

      {props.warnings.length === 0 ? null : (
        <InspectorBlock title="Look at these">
          <ul className="m-0 grid gap-1 pl-4 text-xs text-fg-1">
            {props.warnings.map((w) => <li key={w}>{plainWarning(w, (i) => nameOf(named, i), several)}</li>)}
          </ul>
        </InspectorBlock>
      )}

      <InspectorBlock title={`The ranks · ${ranked.length}`}>
        <div className="grid gap-1">
          {ranked.map((e) => (
            <div
              key={e.source ?? 0}
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelect(e.rank)
                setPicking(null)
              }}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") onSelect(e.rank)
              }}
              className={cn(
                "grid cursor-pointer gap-1.5 rounded-ctl bg-item p-2 outline-none hover:bg-item-hover",
                e.rank === entry.rank && "shadow-[inset_0_0_0_1px_var(--lemon)]"
              )}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="w-6 shrink-0 font-[Arial_Black,Arial,sans-serif] text-sm font-black" style={{ color: rankInk(e.rank, ranked.length) }}>
                  {e.rank}.
                </span>
                <span className="min-w-0 truncate text-sm">{e.label} {e.emoji}</span>
                <span className="ml-auto shrink-0 text-xs text-fg-3">{entrySeconds(e).toFixed(1)}s</span>
                <span className="flex shrink-0" onClick={(ev) => ev.stopPropagation()}>
                  <IconButton label={`Move #${e.rank} up`} disabled={!editable || e.rank === 1} onClick={() => onDraft(moveRank(draft, e.rank, -1))}><ArrowUp /></IconButton>
                  <IconButton label={`Move #${e.rank} down`} disabled={!editable || e.rank === ranked.length} onClick={() => onDraft(moveRank(draft, e.rank, 1))}><ArrowDown /></IconButton>
                  <Menu label={`More for #${e.rank}`}>
                    <MenuItem onClick={() => void navigate({ to: "/videos/$sourceId", params: { sourceId: props.videos[e.source ?? 0]?.sourceId ?? "" } })}>
                      <ExternalLink />Open the video
                    </MenuItem>
                    <MenuItem tone="danger" disabled={!editable || ranked.length <= 2} onClick={() => onDraft(removeEntry(draft, e.rank), true)}>
                      <Trash2 />Remove this entry
                    </MenuItem>
                  </Menu>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <ClipBadge source={e.source} videos={source.videos.length} />
                <div className="ml-auto grid grid-cols-3 gap-1">
                  {e.shots.slice(0, 3).map((s, k) => {
                    const url = stillOf(e.rank, k)
                    return (
                      <div key={k} className="relative aspect-video w-[52px] overflow-hidden rounded-[4px] bg-ctl-active" title={`${ROLE_NAMES[s.role]} · ${clock(s.start)}`}>
                        {url === null ? <Skeleton className="size-full rounded-none" /> : <img src={url} alt="" className="size-full object-cover" loading="lazy" />}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </InspectorBlock>

      <InspectorBlock
        title={`#${entry.rank}`}
        action={
          <span className="flex gap-1">
            <IconButton label="Rank above" disabled={entry.rank === 1} onClick={() => onSelect(entry.rank - 1)}><ChevronLeft /></IconButton>
            <IconButton label="Rank below" disabled={entry.rank === ranked.length} onClick={() => onSelect(entry.rank + 1)}><ChevronRight /></IconButton>
          </span>
        }
      >
        <div className="flex gap-1.5">
          <Input
            aria-label="Label"
            className="min-w-0 flex-1"
            value={entry.label}
            disabled={!editable}
            maxLength={source.labelChars + 8}
            onChange={(ev) => onDraft(setEntry(draft, entry.rank, { label: ev.currentTarget.value }))}
          />
          <Input
            aria-label="Emoji"
            className="w-12 text-center"
            value={entry.emoji}
            disabled={!editable}
            onChange={(ev) => onDraft(setEntry(draft, entry.rank, { emoji: ev.currentTarget.value }))}
          />
        </div>
        <span className={entry.label.trim().length > source.labelChars ? "text-xs text-danger" : "text-xs text-fg-3"}>
          {entry.label.trim().length}/{source.labelChars} characters · one emoji
        </span>
      </InspectorBlock>

      {entry.shots.map((s, k) => {
        const url = stillOf(entry.rank, k)
        const said = video === undefined ? "" : wordsIn(video.words, s.start, s.end)
        return (
          <InspectorBlock key={k} title={`${ROLE_NAMES[s.role]} · ${(s.end - s.start).toFixed(1)}s`} action={<span className="font-normal text-fg-3">{FRAMING_NAMES[s.framing ?? video?.framing ?? "window"]}</span>}>
            {picking === k ? (
              <FramePicker
                videos={props.videos}
                source={entry.source ?? 0}
                around={s.start}
                current={s.start}
                chosen={candidate}
                onChoose={setCandidate}
                onUse={(frame) => {
                  setPicking(null)
                  setCandidate(null)
                  if (frame.source === (entry.source ?? 0)) onDraft(moveShotTo(draft, entry.rank, k, frame.t), true)
                }}
                onCancel={() => {
                  setPicking(null)
                  setCandidate(null)
                }}
                stillUrl={props.stillUrl}
              />
            ) : (
              <button
                type="button"
                disabled={!editable}
                title={editable ? "Pick another moment" : undefined}
                onClick={() => setPicking(k)}
                className="relative aspect-video w-full overflow-hidden rounded-[8px] bg-ctl-active outline-none enabled:hover:shadow-[0_0_0_1px_var(--line-2)]"
              >
                {url === null ? <Skeleton className="size-full rounded-none" /> : <img src={url} alt="" className="size-full object-cover" />}
                <span className="absolute bottom-1 left-1 rounded-[4px] bg-black/70 px-1 text-[10px] text-white">{clock(s.start)}–{clock(s.end)}</span>
              </button>
            )}
            <span className="text-sm text-fg-2">{s.note}</span>
            {said === "" ? <span className="text-xs text-fg-3">No one speaks here.</span> : <span className="text-xs text-fg-1">“{said}”</span>}
            <Detail>
              <EdgeNudge label="Start" at={s.start} disabled={!editable} onNudge={(d) => onDraft(nudgeShot(draft, entry.rank, k, "start", d), true)} />
              <EdgeNudge label="End" at={s.end} disabled={!editable} onNudge={(d) => onDraft(nudgeShot(draft, entry.rank, k, "end", d), true)} />
            </Detail>
          </InspectorBlock>
        )
      })}
      <span className="text-xs text-fg-2">
        {editable
          ? "Every cut is moved to whole sentences, so a clip never stops mid-word. Click a frame to pick another moment."
          : "The ranking can be changed while this step is waiting for you. Changes to an approved ranking aren't supported yet."}
      </span>
      <Detail>
        <Facts rows={[
          ["Video", named.titles[entry.source ?? 0] ?? nameOf(named, entry.source ?? 0)],
          ["Plays", `${draft.order.indexOf(entry.rank) + 1} of ${draft.order.length}`]
        ]} />
      </Detail>
      <StepDetails stages={props.stages} names={["moments"]} />
    </>
  )
}

// The title over the list and the order the entries play in (#1 always last).
function OrderTab({ draft, onDraft, gate, source }: RankingInspectorProps) {
  const editable = gate.request !== null
  const byRankMap = new Map(draft.entries.map((e) => [e.rank, e]))
  const [seed, setSeed] = useState(1)
  return (
    <>
      <InspectorBlock title="Play order" action={<span className="font-normal text-fg-3">#1 plays last</span>}>
        <div className="flex flex-wrap gap-1">
          {draft.order.map((rank, i) => {
            const e = byRankMap.get(rank)
            return (
              <span key={rank} className="inline-flex h-7 items-center gap-1 rounded-ctl bg-item px-2 text-xs">
                <span className="font-bold" style={{ color: rankInk(rank, draft.entries.length) }}>#{rank}</span>
                <span className="max-w-[90px] truncate text-fg-2">{e?.label}</span>
                <Detail>
                  <span className="flex">
                    <IconButton label={`Play #${rank} earlier`} disabled={!editable || rank === 1 || i === 0} onClick={() => onDraft(moveInOrder(draft, rank, -1))}><ChevronLeft /></IconButton>
                    <IconButton label={`Play #${rank} later`} disabled={!editable || rank === 1 || draft.order[i + 1] === 1} onClick={() => onDraft(moveInOrder(draft, rank, 1))}><ChevronRight /></IconButton>
                  </span>
                </Detail>
              </span>
            )
          })}
        </div>
        <div className="flex">
          <Button
            size="sm"
            disabled={!editable}
            onClick={() => {
              onDraft(shuffleAgain(draft, seed + draft.order.length))
              setSeed(seed + 1)
            }}
          >
            <Shuffle />Shuffle again
          </Button>
        </div>
        <span className="text-xs text-fg-2">The list fills in as each entry plays, so a shuffled order keeps viewers waiting for #1.</span>
      </InspectorBlock>
      <Detail>
        <InspectorBlock title="Title">
          <div className="flex gap-1.5">
            <Input aria-label="Title" className="min-w-0 flex-1" value={draft.title.lead} disabled={!editable} onChange={(ev) => onDraft({ ...draft, title: { ...draft.title, lead: ev.currentTarget.value } })} />
            <Input aria-label="Word in red" className="w-32" value={draft.title.accent} disabled={!editable} onChange={(ev) => onDraft({ ...draft, title: { ...draft.title, accent: ev.currentTarget.value } })} />
          </div>
          <span className="text-xs text-fg-2">The second part is drawn in red, like “Ranking Animal <span style={{ color: "#E8202A" }}>Comebacks</span>”.</span>
        </InspectorBlock>
      </Detail>
      <span className="text-xs text-fg-2">Up to {source.maxSeconds.toFixed(0)}s, each clip with its own sound.</span>
    </>
  )
}
