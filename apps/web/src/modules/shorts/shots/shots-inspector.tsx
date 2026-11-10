import type { Preset, ShotPlan, StageRun } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Segmented } from "@viral/ui/primitives/segmented"
import { ChevronLeft, ChevronRight, Image } from "lucide-react"
import { Facts, InspectorBlock } from "../editor-frame.tsx"
import type { GateControls } from "../gate.ts"
import { StepDetails } from "../step-details.tsx"
import { Detail } from "../../system/detail.tsx"
import { VideoDot } from "../../sets/video-badge.tsx"
import { nameOf, useShortVideos } from "../short-videos.tsx"
import { FramePicker, type PickedFrame, type PickerVideo } from "./frame-picker.tsx"
import { changedShots, mmss, type ShotChange, type ShotDraft, shotWith } from "./shots-values.ts"

const SPEEDS = { min: 0.5, max: 4, step: 0.25 }

// A labelled range slider for a 0–1 or speed value, in the lemon accent.
function Slider({ label, value, min, max, step, shown, disabled, onChange }: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly shown: string
  readonly disabled: boolean
  readonly onChange: (value: number) => void
}) {
  return (
    <InspectorBlock title={label} action={<span className="font-normal text-fg">{shown}</span>}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="h-7 w-full cursor-pointer accent-[var(--lemon)] disabled:cursor-not-allowed disabled:opacity-45"
      />
    </InspectorBlock>
  )
}

export interface ShotsInspectorProps {
  readonly plan: ShotPlan
  readonly draft: ShotDraft
  readonly preset: Preset
  readonly selected: number
  readonly onSelect: (k: number) => void
  readonly onChange: (k: number, change: ShotChange) => void
  readonly frameOf: (k: number) => string | null
  // the short's videos, the first one first
  readonly videos: ReadonlyArray<PickerVideo>
  readonly stillUrl: (path: string, source: number) => string
  // the frame picker: open for the selected shot, with the still being tried
  readonly picking: boolean
  readonly onPicking: (open: boolean) => void
  readonly candidate: PickedFrame | null
  readonly onCandidate: (frame: PickedFrame | null) => void
  // your edit: checking and sending it, its problems
  readonly problems: ReadonlyArray<string>
  readonly onRevert: () => void
  readonly onSend: () => void
  readonly stages: ReadonlyArray<StageRun>
  readonly gate: GateControls
}

// The selected shot in the Library panel (Shots step): its frame, words and note, its framing, crop and speed, a frame
// picker, and your changes collected as one edit you send to the gate. The highlighted words are in Captions.
export function ShotsInspector(props: ShotsInspectorProps) {
  const { plan, draft, preset, selected, onSelect, onChange, frameOf, gate } = props
  const named = useShortVideos()
  const shot = plan.shots[selected]
  if (shot === undefined) return null
  const now = shotWith(shot, draft.get(selected))
  const editable = gate.request !== null
  const changes = changedShots(plan, draft)
  const full = preset.config.framing === "full"
  const videos = props.videos
  const source = now.source ?? 0
  const videoTitle = videos[source]?.title ?? "Untitled video"

  return (
    <>
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto px-3.5 pt-1 pb-4">
        {(
          <>
            <InspectorBlock
              title={`Shot ${selected + 1}`}
              action={
                <span className="flex gap-1">
                  <IconButton label="Previous shot" disabled={selected === 0} onClick={() => onSelect(selected - 1)}><ChevronLeft /></IconButton>
                  <IconButton label="Next shot" disabled={selected === plan.shots.length - 1} onClick={() => onSelect(selected + 1)}><ChevronRight /></IconButton>
                </span>
              }
            >
              <div className="aspect-video overflow-hidden rounded-[8px] bg-ctl-active">
                {frameOf(selected) === null ? null : <img src={frameOf(selected)!} alt={shot.note} className="size-full object-cover" />}
              </div>
              <span className="font-medium">“{shot.wordText}…”</span>
              <span className="text-sm text-fg-2">{shot.note}</span>
              {videos.length < 2 ? null : (
                <span className="flex min-w-0 items-center gap-2 text-xs text-fg-2">
                  <VideoDot index={source} />
                  <span className="truncate">{videoTitle}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{mmss(now.src)}</span>
                </span>
              )}
            </InspectorBlock>

            {props.picking ? (
              <FramePicker
                videos={videos}
                source={source}
                around={now.src}
                current={now.src}
                chosen={props.candidate}
                onChoose={props.onCandidate}
                onUse={(frame) => {
                  onChange(selected, { src: frame.t, source: frame.source, still: frame.path })
                  props.onCandidate(null)
                  props.onPicking(false)
                }}
                onCancel={() => {
                  props.onCandidate(null)
                  props.onPicking(false)
                }}
                stillUrl={props.stillUrl}
              />
            ) : (
              <>
                <InspectorBlock title="Framing">
                  <Segmented<"fill" | "whole">
                    label="Framing"
                    full
                    value={now.fit === true ? "whole" : "fill"}
                    onChange={(v) => editable && onChange(selected, { fit: v === "whole" })}
                    options={[{ value: "fill", label: "Fill" }, { value: "whole", label: "Whole frame" }]}
                  />
                </InspectorBlock>
                {full && now.fit !== true ? (
                  <Slider
                    label="Crop"
                    value={now.cropX ?? 0.5}
                    min={0}
                    max={1}
                    step={0.05}
                    shown={(now.cropX ?? 0.5) === 0.5 ? "centre" : (now.cropX ?? 0.5) < 0.5 ? "left" : "right"}
                    disabled={!editable}
                    onChange={(cropX) => onChange(selected, { cropX })}
                  />
                ) : null}
                <Slider
                  label="Speed"
                  value={now.speed ?? 1}
                  min={SPEEDS.min}
                  max={SPEEDS.max}
                  step={SPEEDS.step}
                  shown={`×${now.speed ?? 1}`}
                  disabled={!editable}
                  onChange={(speed) => onChange(selected, { speed })}
                />
                <Detail>
                  <Facts rows={[
                    ["From the video at", `${videos.length < 2 ? "" : `${nameOf(named, source)} · `}${mmss(now.src)} · ${now.src.toFixed(1)}s`],
                    ["Starts on word", `${shot.word} · “${shot.wordText}”`]
                  ]} />
                </Detail>
                <Button className="justify-self-start" disabled={!editable} onClick={() => props.onPicking(true)}><Image />Pick another frame</Button>
                {editable ? null : <span className="text-xs text-fg-2">Shots can be changed while this step is waiting for you.</span>}
              </>
            )}

            <StepDetails stages={props.stages} names={["shots"]} />
          </>
        )}
      </div>
      {changes === 0 && props.problems.length === 0 ? null : (
        <div className="grid shrink-0 gap-2 px-4 py-2.5 shadow-[inset_0_1px_0_var(--line)]">
          {props.problems.length === 0 ? null : (
            <ul className="m-0 grid max-h-[120px] gap-1 overflow-auto pl-4 text-xs text-danger">{props.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm">{changes} {changes === 1 ? "change" : "changes"}</span>
            <Button className="ml-auto" variant="ghost" disabled={gate.busy} onClick={props.onRevert}>Revert</Button>
            <Button variant="primary" disabled={!editable || gate.busy || changes === 0} onClick={props.onSend}>Send edit</Button>
          </div>
        </div>
      )}
    </>
  )
}
