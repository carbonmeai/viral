import type { MusicBed, MusicBlock, MusicTrack, TranscriptWord } from "@viral/contracts"
import { MAX_MUSIC_BLOCKS } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Menu, MenuItem, MenuSeparator, MenuSub } from "@viral/ui/primitives/menu"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Copy, Eye, Minus, MoveDown, MoveUp, Plus, RotateCcw, Scissors, Trash2, Undo2 } from "lucide-react"
import { type PointerEvent, useRef, useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { clockOf } from "../editor-values.ts"
import { InspectorBlock } from "../editor-frame.tsx"
import {
  addBlock,
  arrangementProblems,
  type BarGrid,
  blockLabel,
  blockName,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  moveRange,
  type PlaceContext,
  type PlacedBlock,
  pinOf,
  songRangeOf,
  splitBlock,
  withBlock
} from "./music-values.ts"
import { MusicWaveform } from "./music-waveform.tsx"
import type { ArrangeState } from "./use-arrange-draft.ts"

type StartKind = "after" | "drop" | "word"
const kindOf = (b: MusicBlock): StartKind => (b.start === "after" ? "after" : b.start === "drop" ? "drop" : "word")

// bars from–to on the grid, counted from 1: "Bars 9–10", "Bar 9"
const barSpan = (from: number, to: number) => (to - from === 1 ? `Bar ${to}` : `Bars ${from + 1}–${to}`)

const plainWord = (w: TranscriptWord | undefined) => w?.w.replace(/[^\p{L}\p{N}'’-]/gu, "") ?? ""

// The Arrange tab of the Music step: the parts of the song the bed plays, in order, and the one selected (its bars
// on the song's waveform, how many times it plays, where it starts). Edits collect into a draft you can preview
// (hear it with the voice, nothing changes) and apply (the short is laid out and rendered again).
export function ArrangeInspector({ arrange, bed, grid, track, trackUrl, words, place, placed, picking, onPicking, running }: {
  readonly arrange: ArrangeState
  readonly bed: MusicBed
  readonly grid: BarGrid
  readonly track: MusicTrack
  readonly trackUrl: string
  readonly words: ReadonlyArray<TranscriptWord>
  readonly place: PlaceContext
  // where each part plays in the short, as the lane shows it
  readonly placed: ReadonlyArray<PlacedBlock | null>
  // the narration's words are waiting for a click, to pin the selected part to one
  readonly picking: boolean
  readonly onPicking: (picking: boolean) => void
  readonly running: boolean
}) {
  const blocks = arrange.blocks ?? []
  const k = arrange.selected
  const block = blocks[k]
  const draft = arrange.draft
  const automatic = draft === null ? bed.arrangement?.automatic === true : draft.automatic
  const problems = draft === null ? [] : arrangementProblems(draft.blocks, { ...place, songBars: grid.songBars, words })
  const firstPin = blocks.findIndex((b) => pinOf(b, place.dropWord) !== null)

  const startLine = (b: MusicBlock, i: number) => {
    const word = pinOf(b, place.dropWord)
    if (b.start === "drop") return `On the drop word “${plainWord(words[word ?? -1])}”`
    if (b.start !== "after") return `On “${plainWord(words[b.start.word])}”`
    if (i === 0) return firstPin > 0 ? "Fills the start" : "From the start"
    return "After the part before"
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
      <div className="grid min-h-0 content-start gap-5 overflow-auto p-4">
        <InspectorBlock
          title="Arrangement"
          action={
            <span className="flex items-center gap-1">
              <span className="font-normal text-fg-3">{draft !== null ? "Changed" : automatic ? "Automatic" : "Yours"}</span>
              <Menu label="More for the arrangement">
                <MenuItem disabled={arrange.busy !== null || (automatic && draft === null)} onClick={arrange.resetToAutomatic}>
                  <RotateCcw />Reset to automatic
                </MenuItem>
              </Menu>
            </span>
          }
        >
          <span className="text-xs text-fg-2">
            {automatic
              ? "The song’s build-up loops so its drop lands on the drop word. Change any part to make it yours."
              : "The parts of the song that play, in order. Select one to change it."}
          </span>
          <div role="listbox" aria-label="Parts" className="grid gap-px">
            {blocks.map((b, i) => {
              const at = placed[i]
              return (
                <div
                  key={i}
                  role="option"
                  aria-selected={i === k}
                  tabIndex={0}
                  onClick={() => arrange.select(i)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && arrange.select(i)}
                  className={cn(
                    "grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-ctl px-2 py-1.5 outline-none hover:bg-ctl focus-visible:bg-ctl",
                    i === k && "bg-sel shadow-[inset_0_0_0_1px_var(--lemon)] hover:bg-sel"
                  )}
                >
                  <span className="text-xs text-fg-3 tabular-nums">{i + 1}</span>
                  <span className="grid min-w-0">
                    <span className="truncate text-sm">{blockLabel(b, grid.dropBar)}</span>
                    <span className="truncate text-xs text-fg-2">{startLine(b, i)}</span>
                  </span>
                  <span className="text-xs text-fg-3 tabular-nums">{at === null || at === undefined ? "not heard" : clockOf(at.atS)}</span>
                </div>
              )
            })}
          </div>
          <div>
            <Button variant="ghost" disabled={blocks.length >= MAX_MUSIC_BLOCKS} onClick={() => arrange.edit(addBlock(blocks, grid.songBars), blocks.length)}>
              <Plus />Add a part
            </Button>
          </div>
        </InspectorBlock>

        {block === undefined ? null : (
          <PartEditor
            key={k}
            block={block}
            index={k}
            count={blocks.length}
            grid={grid}
            track={track}
            trackUrl={trackUrl}
            words={words}
            dropWord={place.dropWord}
            picking={picking}
            onPicking={onPicking}
            onChange={(next) => arrange.edit(withBlock(blocks, k, next))}
            onSplit={(bar) => arrange.edit(splitBlock(blocks, k, bar))}
            onDuplicate={() => arrange.edit(duplicateBlock(blocks, k), k + 1)}
            onMove={(by) => arrange.edit(moveBlock(blocks, k, by), k + by)}
            onDelete={() => arrange.edit(deleteBlock(blocks, k), Math.max(0, k - 1))}
          />
        )}
      </div>

      {draft === null && arrange.problems.length === 0 ? null : (
        <div className="grid gap-2 bg-win px-4 pt-3 pb-4 shadow-[inset_0_1px_0_var(--line)]">
          {[...problems, ...arrange.problems].length === 0 ? (
            <span className="text-xs text-fg-2">
              {arrange.heard !== null ? "You’re hearing your changes on the stage. " : "Preview to hear your changes with the voice. "}
              Applying lays the short out and renders it again; nothing is regenerated.{running ? " The run going now is stopped first." : ""}
            </span>
          ) : (
            <ul className="m-0 grid gap-1 pl-4 text-xs text-danger">{[...problems, ...arrange.problems].map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="flex items-center gap-1.5">
            <IconButton label="Undo" disabled={!arrange.canUndo || arrange.busy !== null} onClick={arrange.undo}><Undo2 /></IconButton>
            <Button variant="ghost" disabled={arrange.busy !== null} onClick={arrange.discard}>Discard</Button>
            <span className="ml-auto" />
            <Button disabled={draft === null || problems.length > 0 || arrange.busy !== null || arrange.heard !== null} onClick={arrange.preview}>
              <Eye />{arrange.busy === "preview" ? "Making it…" : arrange.heard !== null ? "Previewing" : "Preview"}
            </Button>
            <Button variant="primary" disabled={draft === null || problems.length > 0 || arrange.busy !== null} onClick={arrange.apply}>
              {arrange.busy === "apply" ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// The selected part: its bars on the song (drag to use another part, drag an edge to change its length; both snap
// to bars), how many times it plays, and where it starts.
function PartEditor({ block, index, count, grid, track, trackUrl, words, dropWord, picking, onPicking, onChange, onSplit, onDuplicate, onMove, onDelete }: {
  readonly block: MusicBlock
  readonly index: number
  readonly count: number
  readonly grid: BarGrid
  readonly track: MusicTrack
  readonly trackUrl: string
  readonly words: ReadonlyArray<TranscriptWord>
  readonly dropWord: number | null
  readonly picking: boolean
  readonly onPicking: (picking: boolean) => void
  readonly onChange: (change: Partial<MusicBlock>) => void
  readonly onSplit: (bar: number) => void
  readonly onDuplicate: () => void
  readonly onMove: (by: -1 | 1) => void
  readonly onDelete: () => void
}) {
  // while dragging, the bars under the pointer; applied on release
  const [dragged, setDragged] = useState<Pick<MusicBlock, "fromBar" | "toBar"> | null>(null)
  const shown = dragged ?? block
  const range = songRangeOf(shown, grid)
  const bars = block.toBar - block.fromBar
  const splits = Array.from({ length: Math.max(0, bars - 1) }, (_, i) => block.fromBar + i + 1).slice(0, 24)
  const kind: StartKind = picking ? "word" : kindOf(block)
  const pinned = block.start !== "after" && block.start !== "drop" ? block.start.word : null

  return (
    <InspectorBlock
      title={`Part ${index + 1} · ${blockName(shown, grid.dropBar)}`}
      action={
        <Menu label={`More for part ${index + 1}`}>
          <MenuSub label={<><Scissors />Split at bar</>} disabled={splits.length === 0}>
            {splits.map((bar) => (
              <MenuItem key={bar} onClick={() => onSplit(bar)}>{barSpan(block.fromBar, bar)} and {barSpan(bar, block.toBar).toLowerCase()}</MenuItem>
            ))}
          </MenuSub>
          <MenuItem disabled={count >= MAX_MUSIC_BLOCKS} onClick={onDuplicate}><Copy />Duplicate</MenuItem>
          <MenuItem disabled={index === 0} onClick={() => onMove(-1)}><MoveUp />Move earlier</MenuItem>
          <MenuItem disabled={index === count - 1} onClick={() => onMove(1)}><MoveDown />Move later</MenuItem>
          <MenuSeparator />
          <MenuItem tone="danger" disabled={count <= 1} onClick={onDelete}><Trash2 />Delete</MenuItem>
        </Menu>
      }
    >
      <div className="pt-3">
        <MusicWaveform
          url={trackUrl}
          durationS={track.durationS}
          dropS={track.dropS}
          time={null}
          lit={[range]}
          overlay={(lengthS) => (
            <SongRange
              block={shown}
              grid={grid}
              lengthS={lengthS}
              onDrag={setDragged}
              onDone={(next) => {
                setDragged(null)
                if (next.fromBar !== block.fromBar || next.toBar !== block.toBar) onChange(next)
              }}
            />
          )}
        />
      </div>
      <span className="text-xs text-fg-2">
        {clockOf(range.from)}–{clockOf(range.to)} of the song, {shown.toBar - shown.fromBar} {shown.toBar - shown.fromBar === 1 ? "bar" : "bars"}. Drag it to use another part; drag an edge to change its length.
      </span>

      <div className="grid gap-3 pt-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-fg-2">Plays</span>
          <div className="flex items-center gap-1">
          <IconButton label="Play it fewer times" variant="default" disabled={block.loops <= 1} onClick={() => onChange({ loops: block.loops - 1 })}><Minus /></IconButton>
          <span className="min-w-[64px] text-center text-sm tabular-nums">{block.loops === 1 ? "once" : `${block.loops} times`}</span>
          <IconButton label="Play it more times" variant="default" disabled={block.loops >= 64} onClick={() => onChange({ loops: block.loops + 1 })}><Plus /></IconButton>
          </div>
        </div>

        <div className="grid gap-1.5">
          <span className="text-sm text-fg-2">Starts</span>
          <Segmented<StartKind>
            label="Where this part starts"
            full
            value={kind}
            onChange={(next) => {
              if (next === "word") return onPicking(true)
              onPicking(false)
              onChange({ start: next })
            }}
            options={[
              { value: "after", label: index === 0 ? "At the start" : "After" },
              { value: "drop", label: "Drop word" },
              { value: "word", label: "A word" }
            ]}
          />
          <span className="text-xs text-fg-2">
            {picking ? (
              <>Click the word in the narration this part starts on. <button type="button" className="cursor-pointer text-fg underline-offset-2 hover:underline" onClick={() => onPicking(false)}>Cancel</button></>
            ) : block.start === "drop" ? (
              dropWord === null ? "There’s no drop word yet." : <>It starts on “{plainWord(words[dropWord])}” and follows the drop word if you change it.</>
            ) : pinned !== null ? (
              <>It starts right on “{plainWord(words[pinned])}”. <button type="button" className="cursor-pointer text-fg underline-offset-2 hover:underline" onClick={() => onPicking(true)}>Pick another word</button></>
            ) : index === 0 ? (
              "It plays from the start of the short, or fills the start before a part pinned to a word."
            ) : (
              "It plays straight after the part before it."
            )}
          </span>
        </div>
      </div>
      <Detail>
        <span className="text-xs text-fg-3">Bars {block.fromBar}–{block.toBar} on the song’s grid (the drop is bar {grid.dropBar}, {grid.songBars} bars in all; a bar is {grid.barS.toFixed(2)}s).</span>
      </Detail>
    </InspectorBlock>
  )
}

// The selected part's bars over the song's waveform: a 1px lemon outline you drag (snapping to bars), with an
// edge on each side to make it longer or shorter.
function SongRange({ block, grid, lengthS, onDrag, onDone }: {
  readonly block: Pick<MusicBlock, "fromBar" | "toBar">
  readonly grid: BarGrid
  readonly lengthS: number
  readonly onDrag: (bars: Pick<MusicBlock, "fromBar" | "toBar">) => void
  readonly onDone: (bars: Pick<MusicBlock, "fromBar" | "toBar">) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ readonly mode: "move" | "from" | "to"; readonly x: number; readonly from: number; readonly to: number; last: Pick<MusicBlock, "fromBar" | "toBar"> } | null>(null)
  const range = songRangeOf(block, grid)
  const pct = (s: number) => `${(s / Math.max(lengthS, 0.001)) * 100}%`

  const down = (mode: "move" | "from" | "to") => (e: PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, from: block.fromBar, to: block.toBar, last: block }
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    const width = box.current?.parentElement?.getBoundingClientRect().width ?? 0
    if (d === null || width <= 0) return
    const bars = Math.round(((e.clientX - d.x) / width) * lengthS / grid.barS)
    const next = d.mode === "move"
      ? moveRange({ fromBar: d.from, toBar: d.to, loops: 1, start: "after" }, d.from + bars, grid.songBars)
      : d.mode === "from"
      ? { fromBar: Math.max(0, Math.min(d.to - 1, d.from + bars)), toBar: d.to }
      : { fromBar: d.from, toBar: Math.min(grid.songBars, Math.max(d.from + 1, d.to + bars)) }
    const bars2 = { fromBar: next.fromBar, toBar: next.toBar }
    if (bars2.fromBar !== d.last.fromBar || bars2.toBar !== d.last.toBar) {
      d.last = bars2
      onDrag(bars2)
    }
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (d !== null) onDone(d.last)
  }
  const edge = "absolute inset-y-0 w-2 cursor-ew-resize touch-none"
  return (
    <div
      ref={box}
      role="slider"
      aria-label="The part’s bars in the song"
      aria-valuemin={0}
      aria-valuemax={grid.songBars}
      aria-valuenow={block.fromBar}
      aria-valuetext={`Bars ${block.fromBar + 1} to ${block.toBar}`}
      tabIndex={0}
      onKeyDown={(e) => {
        const by = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0
        if (by === 0) return
        e.preventDefault()
        const next = moveRange({ ...block, loops: 1, start: "after" }, block.fromBar + by, grid.songBars)
        onDone({ fromBar: next.fromBar, toBar: next.toBar })
      }}
      onPointerDown={down("move")}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className="absolute -inset-y-1 cursor-grab touch-none rounded-[4px] shadow-[inset_0_0_0_1px_var(--lemon)] outline-none active:cursor-grabbing focus-visible:shadow-[inset_0_0_0_2px_var(--lemon)]"
      style={{ left: pct(range.from), width: pct(range.to - range.from) }}
    >
      <span className={cn(edge, "-left-1")} onPointerDown={down("from")} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <span className={cn(edge, "-right-1")} onPointerDown={down("to")} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    </div>
  )
}

// A bed fitted before arrangements existed has no parts to show; starting from the automatic one makes them.
export function ArrangeUnavailable({ busy, onStart }: { readonly busy: boolean; readonly onStart: () => void }) {
  return (
    <div className="grid content-start gap-2 p-4">
      <InspectorBlock title="Arrangement">
        <span className="text-xs text-fg-2">This song was fitted before its parts could be arranged. Start from the automatic arrangement to change them.</span>
        <div><Button disabled={busy} onClick={onStart}>{busy ? "Reading the song…" : "Start arranging"}</Button></div>
      </InspectorBlock>
    </div>
  )
}
