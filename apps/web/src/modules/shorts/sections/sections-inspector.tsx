import type { CutBeat, Preset, ShortWorkspace, StageRun } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Select } from "@viral/ui/primitives/select"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, MessageSquare, Play, Plus, Scissors, Search, Trash2, Type } from "lucide-react"
import { useMemo, useState } from "react"
import { AskBox } from "../ask-box.tsx"
import { Facts, InspectorBlock } from "../editor-frame.tsx"
import type { GateControls } from "../gate.ts"
import { type InspectorTab, InspectorTabs } from "../inspector-tabs.tsx"
import { StepDetails } from "../step-details.tsx"
import { useClipPlayer } from "../use-clip-player.ts"
import { Detail } from "../../system/detail.tsx"
import { BeatChip } from "./sections-stage.tsx"
import {
  BEATS,
  clock,
  type EditSection,
  framingOf,
  lengthOf,
  nudge,
  searchTranscript,
  sectionFrom,
  type SectionsDraft,
  totalSeconds
} from "./sections-values.ts"

export type SectionsTab = "section" | "hook" | "add" | "ask"
const TABS: ReadonlyArray<InspectorTab<SectionsTab>> = [
  { id: "section", label: "Section", icon: Scissors },
  { id: "hook", label: "Hook and length", icon: Type },
  { id: "add", label: "Add from the transcript", icon: Search },
  { id: "ask", label: "Ask the agent", icon: MessageSquare }
]

const BEAT_OPTIONS = (Object.keys(BEATS) as ReadonlyArray<CutBeat>).map((beat) => ({ value: beat, label: BEATS[beat].label }))

// A value against its allowed range, as a thin bar: lemon inside the range, red outside.
function Meter({ label, value, shown, range, max }: {
  readonly label: string
  readonly value: number
  readonly shown: string
  readonly range: readonly [number, number]
  readonly max: number
}) {
  const ok = value >= range[0] && value <= range[1]
  const at = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  return (
    <InspectorBlock title={label} action={<span className={ok ? "font-normal text-fg" : "font-normal text-danger"}>{shown}</span>}>
      <div className="relative h-1.5 rounded-full bg-ctl">
        <div className="absolute inset-y-0 rounded-full bg-ctl-active" style={{ left: at(range[0]), width: `calc(${at(range[1])} - ${at(range[0])})` }} />
        <div className={ok ? "absolute inset-y-0 left-0 rounded-full bg-lemon" : "absolute inset-y-0 left-0 rounded-full bg-danger"} style={{ width: at(value) }} />
      </div>
    </InspectorBlock>
  )
}

// −1s, −0.1 · the time · +0.1, +1s for one edge of a section; each step snaps to whole words.
function EdgeNudge({ label, at, disabled, onNudge }: {
  readonly label: string
  readonly at: number
  readonly disabled: boolean
  readonly onNudge: (delta: number) => void
}) {
  const step = (delta: number, text: string) => (
    <Button size="sm" variant="ghost" disabled={disabled} title={`Move the ${label.toLowerCase()} ${delta < 0 ? "earlier" : "later"} to the next word`} onClick={() => onNudge(delta)}>{text}</Button>
  )
  return (
    <div className="flex items-center gap-1">
      <span className="w-10 text-xs text-fg-2">{label}</span>
      {step(-1, "−1s")}
      {step(-0.1, "−0.1")}
      <span className="mx-auto font-mono text-sm tabular-nums">{clock(at)}</span>
      {step(0.1, "+0.1")}
      {step(1, "+1s")}
    </div>
  )
}

export interface SectionsInspectorProps {
  readonly draft: SectionsDraft
  readonly onDraft: (next: SectionsDraft) => void
  readonly changes: number
  readonly preset: Preset
  readonly cut: NonNullable<ShortWorkspace["cutSource"]>
  readonly selected: number
  readonly onSelect: (k: number) => void
  readonly stillOf: (k: number) => string | null
  readonly sourceVideoUrl: string | null
  readonly onPlay: () => void
  readonly problems: ReadonlyArray<string>
  readonly onRevert: () => void
  readonly onSend: () => void
  readonly stages: ReadonlyArray<StageRun>
  readonly gate: GateControls
  readonly tab: SectionsTab
  readonly onTab: (tab: SectionsTab) => void
}

// The Sections step's inspector: the selected section (its beat, edges, framing and place in the order), the hook
// text and the short's length, adding a line from the transcript, and asking the agent. Changes collect as one
// edit, checked by the server before it goes to the gate.
export function SectionsInspector(props: SectionsInspectorProps) {
  const { draft, onDraft, preset, cut, selected, onSelect, gate, tab, onTab } = props
  const editable = gate.request !== null
  const sections = draft.sections
  const section = sections[selected]
  const set = (k: number, next: EditSection) => onDraft({ ...draft, sections: sections.map((s, i) => (i === k ? next : s)) })
  const reorder = (to: number) => {
    if (to < 0 || to >= sections.length) return
    const next = [...sections]
    const [item] = next.splice(selected, 1)
    next.splice(to, 0, item!)
    onDraft({ ...draft, sections: next })
    onSelect(to)
  }

  return (
    <>
      <InspectorTabs tabs={TABS} open={tab} onOpen={onTab} />
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto p-4">
        {tab === "ask" ? (
          <AskBox gate={gate} who="sections agent" placeholder="e.g. Open on “it literally is all the taste at the same time”, from its first word." />
        ) : tab === "hook" ? (
          <HookTab {...props} />
        ) : tab === "add" ? (
          <AddTab {...props} />
        ) : section === undefined ? (
          <span className="text-sm text-fg-2">There are no sections. Add one from the transcript.</span>
        ) : (
          <>
            <InspectorBlock
              title={`Section ${selected + 1} of ${sections.length}`}
              action={
                <span className="flex gap-1">
                  <IconButton label="Previous section" disabled={selected === 0} onClick={() => onSelect(selected - 1)}><ChevronLeft /></IconButton>
                  <IconButton label="Next section" disabled={selected === sections.length - 1} onClick={() => onSelect(selected + 1)}><ChevronRight /></IconButton>
                </span>
              }
            >
              <div className="aspect-video overflow-hidden rounded-[8px] bg-ctl-active">
                {props.stillOf(selected) === null ? <Skeleton className="size-full rounded-none" /> : <img src={props.stillOf(selected)!} alt="" className="size-full object-cover" />}
              </div>
              <span className="font-medium">“{section.text}”</span>
              <span className="text-sm text-fg-2">{section.note}</span>
              <div className="flex items-center gap-2">
                <BeatChip beat={section.beat} />
                <span className="text-xs text-fg-2">{lengthOf(section).toFixed(1)}s</span>
                <Button className="ml-auto" size="sm" disabled={props.sourceVideoUrl === null} onClick={props.onPlay}><Play />Play</Button>
              </div>
            </InspectorBlock>

            <InspectorBlock title="Beat">
              <Select<CutBeat>
                label="Beat"
                value={section.beat}
                options={BEAT_OPTIONS}
                onChange={(beat) => editable && set(selected, { ...section, beat })}
              />
            </InspectorBlock>

            <InspectorBlock title="From the video">
              <EdgeNudge label="Start" at={section.start} disabled={!editable} onNudge={(d) => set(selected, nudge(section, "start", d, cut.words, cut.sourceSeconds))} />
              <EdgeNudge label="End" at={section.end} disabled={!editable} onNudge={(d) => set(selected, nudge(section, "end", d, cut.words, cut.sourceSeconds))} />
              <span className="text-xs text-fg-2">Each step moves to the next whole word.</span>
            </InspectorBlock>

            <InspectorBlock title="Framing">
              <Segmented<"crop" | "blur">
                label="Framing"
                full
                value={framingOf(section, preset.config)}
                onChange={(framing) => editable && set(selected, { ...section, framing })}
                options={[{ value: "crop", label: "Fill" }, { value: "blur", label: "Whole frame" }]}
              />
            </InspectorBlock>
            {framingOf(section, preset.config) === "crop" ? (
              <InspectorBlock title="Crop" action={<span className="font-normal text-fg">{(section.cropX ?? 0.5) === 0.5 ? "centre" : (section.cropX ?? 0.5) < 0.5 ? "left" : "right"}</span>}>
                <input
                  type="range"
                  aria-label="Crop"
                  min={0}
                  max={1}
                  step={0.05}
                  value={section.cropX ?? 0.5}
                  disabled={!editable}
                  onChange={(e) => set(selected, { ...section, cropX: Number(e.currentTarget.value) })}
                  className="h-7 w-full cursor-pointer accent-[var(--lemon)] disabled:cursor-not-allowed disabled:opacity-45"
                />
              </InspectorBlock>
            ) : null}

            <InspectorBlock title="Order">
              <div className="flex gap-1.5">
                <Button size="sm" disabled={!editable || selected === 0} onClick={() => reorder(selected - 1)}><ArrowUp />Earlier</Button>
                <Button size="sm" disabled={!editable || selected === sections.length - 1} onClick={() => reorder(selected + 1)}><ArrowDown />Later</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-danger"
                  disabled={!editable || sections.length <= 1}
                  onClick={() => {
                    onDraft({ ...draft, sections: sections.filter((_, i) => i !== selected) })
                    onSelect(Math.max(0, selected - 1))
                  }}
                >
                  <Trash2 />Remove
                </Button>
              </div>
            </InspectorBlock>

            <Detail>
              <Facts rows={[
                ["Source", `${clock(section.start)}–${clock(section.end)}`],
                ["Seconds", `${section.start.toFixed(2)}–${section.end.toFixed(2)}`]
              ]} />
            </Detail>
            {editable ? null : <span className="text-xs text-fg-2">Sections can be changed while this step is waiting for you.</span>}
            <StepDetails stages={props.stages} names={["sections"]} />
          </>
        )}
      </div>
      {props.changes === 0 && props.problems.length === 0 ? null : (
        <div className="grid shrink-0 gap-2 px-4 py-2.5 shadow-[inset_0_1px_0_var(--line)]">
          {props.problems.length === 0 ? null : (
            <ul className="m-0 grid max-h-[120px] gap-1 overflow-auto pl-4 text-xs text-danger">{props.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm">{props.changes} {props.changes === 1 ? "change" : "changes"}</span>
            <Button className="ml-auto" variant="ghost" disabled={gate.busy} onClick={props.onRevert}>Revert</Button>
            <Button variant="primary" disabled={!editable || gate.busy || props.changes === 0} onClick={props.onSend}>Send edit</Button>
          </div>
        </div>
      )}
    </>
  )
}

const countWords = (text: string) => text.split(/\s+/).filter((w) => /\w/.test(w)).length

// The hook card's text and the short's length against the limits.
function HookTab({ draft, onDraft, cut, gate }: SectionsInspectorProps) {
  const total = totalSeconds(draft.sections)
  const words = countWords(draft.hookText ?? "")
  return (
    <>
      <InspectorBlock title="Hook text" action={<span className={words > cut.limits.hookWords ? "font-normal text-danger" : "font-normal text-fg-3"}>{words}/{cut.limits.hookWords} words</span>}>
        <Input
          aria-label="Hook text"
          value={draft.hookText ?? ""}
          disabled={gate.request === null}
          placeholder="No hook card"
          onChange={(e) => onDraft({ ...draft, hookText: e.currentTarget.value })}
        />
        <span className="text-xs text-fg-2">The open loop over the first section, readable with the sound off. Shown in styles with a headline.</span>
      </InspectorBlock>
      <Meter
        label="Length"
        value={total}
        shown={`${total.toFixed(1)}s`}
        range={[cut.limits.total[0], cut.limits.total[1]]}
        max={cut.limits.total[1] * 1.25}
      />
      <span className="text-xs text-fg-2">A cut-down short runs {cut.limits.total[0]}–{cut.limits.total[1]}s, each section at least {cut.limits.minSection}s.</span>
    </>
  )
}

// Find a line in the long video by its words and add it as a section after the selected one.
function AddTab({ draft, onDraft, cut, selected, onSelect, sourceVideoUrl, gate }: SectionsInspectorProps) {
  const [query, setQuery] = useState("")
  const [beat, setBeat] = useState<CutBeat>("rising_action")
  const clips = useClipPlayer(sourceVideoUrl)
  const found = useMemo(() => searchTranscript(cut.words, query), [cut.words, query])
  const editable = gate.request !== null
  const inAd = (m: { readonly start: number; readonly end: number }) => cut.excluded.some((r) => m.start < r.end && m.end > r.start)
  return (
    <>
      <InspectorBlock title="Find a line">
        <Input aria-label="Words to find" placeholder="e.g. so nasty" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      </InspectorBlock>
      <InspectorBlock title="Add as">
        <Select<CutBeat> label="Beat for the new section" value={beat} options={BEAT_OPTIONS} onChange={setBeat} />
      </InspectorBlock>
      {query.trim().length >= 2 && found.length === 0 ? <span className="text-sm text-fg-2">Nobody says that in the video.</span> : null}
      <div className="grid gap-1.5">
        {found.map((m) => {
          const key = `found-${m.start}`
          const ad = inAd(m)
          return (
            <div key={key} className="grid gap-1.5 rounded-ctl bg-item p-2.5">
              <span className="text-sm text-fg-1">“{m.text}”</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-fg-3">{clock(m.start)}</span>
                {ad ? <span className="text-xs text-danger">in an ad</span> : null}
                <IconButton label="Play" disabled={sourceVideoUrl === null} onClick={() => clips.play(key, m.start, m.end)}><Play /></IconButton>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={!editable || ad}
                  onClick={() => {
                    const at = Math.min(selected + 1, draft.sections.length)
                    const next = [...draft.sections]
                    next.splice(at, 0, sectionFrom(m, beat, cut.words, cut.sourceSeconds))
                    onDraft({ ...draft, sections: next })
                    onSelect(at)
                  }}
                >
                  <Plus />Add after {selected + 1}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      {editable ? null : <span className="text-xs text-fg-2">Sections can be added while this step is waiting for you.</span>}
    </>
  )
}
