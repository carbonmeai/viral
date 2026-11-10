import { Segmented } from "@viral/ui/primitives/segmented"
import { Eye, LayoutGrid } from "lucide-react"
import { NothingToInspect, NotYet, StyleChips } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { ShotsInspector } from "./shots-inspector.tsx"
import { ShotsStage, type ShotsView } from "./shots-stage.tsx"
import { proposalOf } from "./shots-values.ts"

// The selected shot, kept inside the plan.
const selectedShot = (e: EditorState) => Math.min(e.shotK, (e.ws.shotPlan?.plan.shots.length ?? 1) - 1)

// The Shots step: the selected shot as the short shows it (or the storyboard) on the stage; the shot's frame,
// framing, crop and speed in the inspector, with your changes collected as one edit.
export function ShotsStepStage({ e }: { readonly e: EditorState }) {
  const { ws } = e
  if (ws.shotPlan === null) return <NotYet e={e} what="shot plan" />
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3.5 py-2.5">
        <Segmented<ShotsView>
          label="Stage"
          value={e.shotsView}
          onChange={e.setShotsView}
          options={[
            { value: "preview", label: <><Eye className="size-3.5" />Preview</> },
            { value: "storyboard", label: <><LayoutGrid className="size-3.5" />Storyboard</> }
          ]}
        />
        <StyleChips e={e} />
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

export function ShotsStepPanel({ e }: { readonly e: EditorState }) {
  const { ws } = e
  if (ws.shotPlan === null) return <NothingToInspect />
  const plan = ws.shotPlan.plan
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
        void e.gate.edit(proposalOf(plan, e.draft)).then((refused) => {
          e.setShotProblems(refused)
          if (refused.length === 0) e.setDraft(new Map())
        })
      }}
      stages={e.stages}
      gate={e.gate}
      tab={e.shotsTab}
      onTab={e.setShotsTab}
    />
  )
}
