import { Segmented } from "@viral/ui/primitives/segmented"
import { Eye, LayoutGrid } from "lucide-react"
import { NotYet } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { ShotsInspector } from "./shots-inspector.tsx"
import { ShotsStage, type ShotsView } from "./shots-stage.tsx"
import { proposalOf } from "./shots-values.ts"

// The selected shot, kept inside the plan.
export const selectedShot = (e: EditorState) => Math.min(e.shotK, (e.ws.shotPlan?.plan.shots.length ?? 1) - 1)

// The Shots step's player: the selected shot as the short shows it, or every shot as a storyboard.
export function ShotsStepStage({ e }: { readonly e: EditorState }) {
  const { ws } = e
  if (ws.shotPlan === null) return <NotYet e={e} what="shot plan" />
  return (
    <>
      <div className="flex shrink-0 justify-center pb-1.5">
        <Segmented<ShotsView>
          label="Stage"
          value={e.shotsView}
          onChange={e.setShotsView}
          options={[
            { value: "preview", label: <><Eye className="size-3.5" />Preview</> },
            { value: "storyboard", label: <><LayoutGrid className="size-3.5" />Storyboard</> }
          ]}
        />
      </div>
      <ShotsStage
        plan={ws.shotPlan.plan}
        draft={e.draft}
        preset={ws.preset}
        headline={ws.script?.script.headline ?? null}
        view={e.shotsView}
        selected={selectedShot(e)}
        onSelect={(next) => {
          e.selectShot(next)
          e.setShotsView("preview")
        }}
        frameOf={e.shotFrame}
        realFrameOf={e.realFrame}
        candidate={e.candidate === null ? null : e.videoStillUrl(e.candidate.path, e.candidate.source)}
        videos={ws.videos.length}
      />
    </>
  )
}

export const shotsNote = (e: EditorState) => e.ws.shotPlan === null ? null : `${e.ws.shotPlan.plan.shots.length} shots`

// The selected shot in the Library panel: its frame, framing, crop and speed, the frame picker, and your changes
// collected as one edit.
export function ShotDetail({ e }: { readonly e: EditorState }) {
  const { ws } = e
  if (ws.shotPlan === null) return null
  const plan = ws.shotPlan.plan
  const gate = e.gateFor("shots")
  return (
    <ShotsInspector
      plan={plan}
      draft={e.draft}
      preset={ws.preset}
      selected={selectedShot(e)}
      onSelect={e.selectShot}
      onChange={(shot, change) => {
        e.setShotProblems([])
        e.setDraft((d) => new Map(d).set(shot, { ...d.get(shot), ...change }))
      }}
      frameOf={e.shotFrame}
      videos={e.pickerVideos}
      stillUrl={e.videoStillUrl}
      picking={e.picking}
      onPicking={e.setPicking}
      candidate={e.candidate}
      onCandidate={e.setCandidate}
      problems={e.shotProblems}
      onRevert={() => {
        e.setDraft(new Map())
        e.setShotProblems([])
      }}
      onSend={() => {
        void gate.edit(proposalOf(plan, e.draft)).then((refused) => {
          e.setShotProblems(refused)
          if (refused.length === 0) e.setDraft(new Map())
        })
      }}
      stages={e.stages}
      gate={gate}
    />
  )
}
