import type { ProjectFormat, RenderedShort, StageName, StageRun } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Film, Undo2 } from "lucide-react"
import { useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { Facts, InspectorBlock } from "../editor-frame.tsx"
import type { GateControls } from "../gate.ts"
import { type InspectorTab, InspectorTabs } from "../inspector-tabs.tsx"
import { StepDetails } from "../step-details.tsx"

export type RenderTab = "check" | "back"
const TABS: ReadonlyArray<InspectorTab<RenderTab>> = [
  { id: "check", label: "Check it", icon: Film },
  { id: "back", label: "Send back", icon: Undo2 }
]

// Where a render's problem is fixed: a wrong shot (or section) goes back to that step's agent; a style problem
// (captions, headline, framing, music) is laid out again with the short's current style.
export const sendBackTargets = (format: ProjectFormat): ReadonlyArray<{ readonly to: StageName; readonly label: string; readonly help: string }> => [
  format === "ranking"
    ? { to: "moments", label: "Ranking", help: "The moments agent gets your note in the same conversation. Then the ranking is assembled and rendered again (about 2 minutes)." }
    : format === "cut-down"
    ? { to: "sections", label: "Sections", help: "The sections agent gets your note in the same conversation. Then the short is assembled and rendered again (about 2 minutes)." }
    : { to: "shots", label: "Shots", help: "The shots agent gets your note in the same conversation. Then the short is assembled and rendered again (about 2 minutes). The script and voice stay as they are." },
  { to: "assemble", label: "Style", help: "The short is laid out again with its style as it is now (change it under Styles first), then rendered. Nothing is regenerated, so it costs nothing." }
]

// The render step's inspector: the check sheet (a frame a second, so every shot can be checked against what's
// said), the render's numbers, and sending it back with a note.
export function RenderInspector({ render, checkSheetUrl, checkFrameUrl, format, stages, gate, tab, onTab }: {
  readonly render: RenderedShort
  readonly checkSheetUrl: string | null
  // a ranking's check frame (an absolute path next to the render) as a URL, when the render's file is in the library
  readonly checkFrameUrl?: ((file: string) => string) | null
  readonly format: ProjectFormat
  readonly stages: ReadonlyArray<StageRun>
  readonly gate: GateControls
  readonly tab: RenderTab
  readonly onTab: (tab: RenderTab) => void
}) {
  const targets = sendBackTargets(format)
  const [to, setTo] = useState<StageName>(targets[0]!.to)
  const [note, setNote] = useState("")
  const target = targets.find((t) => t.to === to) ?? targets[0]!
  const waiting = gate.request !== null
  return (
    <>
      <InspectorTabs tabs={TABS} open={tab} onOpen={onTab} />
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto p-4">
        {tab === "check" ? (
          <>
            <InspectorBlock title="Check it" action={<span className="font-normal text-fg-3">a frame a second</span>}>
              {checkSheetUrl === null
                ? <span className="text-xs text-fg-2">This render has no check sheet.</span>
                : (
                  <a href={checkSheetUrl} target="_blank" rel="noreferrer" title="Open the check sheet full size">
                    <img src={checkSheetUrl} alt="A frame for every second of the short" className="w-full rounded-[8px] bg-ctl" />
                  </a>
                )}
              <span className="text-xs text-fg-2">
                Every frame should show what's being said. If one doesn't, send it back with a note.
              </span>
            </InspectorBlock>
            <InspectorBlock title="The short">
              <Facts rows={[["Length", `${render.durationS.toFixed(1)}s`], ["Shots", String(render.shots)]]} />
            </InspectorBlock>
            {render.checks === undefined ? null : <RenderChecksBlock checks={render.checks} frameUrl={checkFrameUrl ?? null} />}
            <Detail>
              <InspectorBlock title="Files">
                <span className="text-xs break-all text-fg-2">{render.video.split("/").pop()}</span>
              </InspectorBlock>
            </Detail>
            <StepDetails stages={stages} names={["assemble", "render"]} />
          </>
        ) : (
          <InspectorBlock title="What should change?">
            <Segmented<StageName>
              label="Send back to"
              full
              value={to}
              onChange={setTo}
              options={targets.map((t) => ({ value: t.to, label: `Back to ${t.label}` }))}
            />
            <textarea
              aria-label="Your note"
              rows={6}
              className="w-full resize-y rounded-ctl bg-ctl px-2.5 py-2 text-base text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--lemon)] disabled:opacity-50"
              placeholder={to === "assemble" ? "e.g. The headline is too small." : "e.g. Shot 7 should be the close-up of the vial, not him standing by the shelf."}
              disabled={!waiting}
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
            <span className="text-xs text-fg-2">{waiting ? target.help : "A render can be sent back while it's waiting for you."}</span>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onTab("check")}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!waiting || gate.busy || note.trim() === ""}
                onClick={() => {
                  gate.sendBack(note.trim(), to)
                  setNote("")
                }}
              >
                <Undo2 />Send back
              </Button>
            </div>
          </InspectorBlock>
        )}
      </div>
    </>
  )
}

// What Viral checked in a ranking's mp4: its loudness, any black frames, and the first and last frame of every shot
// (long shots drift into another animal or a recap).
function RenderChecksBlock({ checks, frameUrl }: { readonly checks: NonNullable<RenderedShort["checks"]>; readonly frameUrl: ((file: string) => string) | null }) {
  const loud = checks.lufs === null ? "Not measured" : `${checks.lufs.toFixed(1)} LUFS${Math.abs(checks.lufs + 14) > 1.5 ? " (aimed for −14)" : ""}`
  const black = checks.black.length === 0 ? "No black frames" : checks.black.map(([s, e]) => `${s.toFixed(1)}–${e.toFixed(1)}s`).join(", ")
  return (
    <InspectorBlock title="Checked">
      <Facts rows={[["Loudness", loud], ["Black frames", <span key="b" className={checks.black.length === 0 ? undefined : "text-danger"}>{black}</span>]]} />
      {frameUrl === null || checks.frames.length === 0 ? null : (
        <>
          <span className="text-xs text-fg-2">Each shot’s first and last frame. Both should show the same animal.</span>
          <div className="grid grid-cols-2 gap-1">
            {checks.frames.map((f) => (
              <div key={`${f.rank}-${f.shot}`} className="grid grid-cols-2 gap-0.5" title={`#${f.rank} shot ${f.shot + 1} · ${f.start.toFixed(1)}–${f.end.toFixed(1)}s`}>
                <img src={frameUrl(f.first)} alt={`#${f.rank} shot ${f.shot + 1}, first frame`} className="aspect-[9/16] w-full rounded-[4px] bg-ctl object-cover" loading="lazy" />
                <img src={frameUrl(f.last)} alt={`#${f.rank} shot ${f.shot + 1}, last frame`} className="aspect-[9/16] w-full rounded-[4px] bg-ctl object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </>
      )}
    </InspectorBlock>
  )
}
