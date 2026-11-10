import { Segmented } from "@viral/ui/primitives/segmented"
import { Eye, LayoutGrid } from "lucide-react"
import { Panel } from "../panel.tsx"
import { NothingToInspect, NotYet } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { SECTIONS_VIEWS, SectionsInspector, type SectionsTab } from "./sections-inspector.tsx"
import { SectionsStage, type SectionsView } from "./sections-stage.tsx"
import { changeCount, proposalOf, type SectionsDraft } from "./sections-values.ts"

// The selected section, kept inside the draft.
const selectedSection = (e: EditorState, sections: SectionsDraft) => Math.min(e.sectionK, Math.max(0, sections.sections.length - 1))
const selectSection = (e: EditorState, sections: SectionsDraft) => (next: number) => {
  e.setSectionK(Math.max(0, Math.min(sections.sections.length - 1, next)))
  e.setSectionPlaying(false)
}

// The Sections step's player (cut-down shorts): the selected section playing, or the storyboard.
export function SectionsStepStage({ e }: { readonly e: EditorState }) {
  const sections = e.sections
  if (sections === null || e.ws.cutSource === null) return <NotYet e={e} what="sections" />
  return (
    <>
      <div className="flex shrink-0 justify-center pb-1.5">
        <Segmented<SectionsView>
          label="Stage"
          value={e.sectionsView}
          onChange={(v) => {
            e.setSectionsView(v)
            e.setSectionPlaying(false)
          }}
          options={[
            { value: "preview", label: <><Eye className="size-3.5" />Preview</> },
            { value: "storyboard", label: <><LayoutGrid className="size-3.5" />Storyboard</> }
          ]}
        />
      </div>
      <SectionsStage
        sections={sections.sections}
        preset={e.ws.preset}
        hookText={sections.hookText}
        view={e.sectionsView}
        selected={selectedSection(e, sections)}
        onSelect={(next) => {
          selectSection(e, sections)(next)
          e.setSectionsView("preview")
        }}
        stillOf={e.sectionStill}
        videoUrlOf={e.videoUrlOf}
        videos={e.ws.videos.length}
        playing={e.sectionPlaying}
        onPlaying={e.setSectionPlaying}
      />
    </>
  )
}

export const sectionsNote = (e: EditorState) => e.sections === null ? null : `${e.sections.sections.length} sections`

// The Sections panel: the selected section, the hook and the short's length, and adding a line from the transcript,
// with your changes collected as one edit.
export function SectionsStepPanel({ e }: { readonly e: EditorState }) {
  const sections = e.sections
  if (sections === null || e.ws.cutSource === null) return <Panel title="Sections"><NothingToInspect /></Panel>
  return (
    <Panel title="Sections" under={<Segmented<SectionsTab> label="Sections view" full value={e.sectionsTab} onChange={e.setSectionsTab} options={SECTIONS_VIEWS} />}>
    <SectionsInspector
      draft={sections}
      onDraft={(next) => {
        e.setSectionProblems([])
        e.setSectionsDraft(next)
      }}
      changes={e.planDraft === null ? 0 : changeCount(e.planDraft, sections)}
      preset={e.ws.preset}
      cut={e.ws.cutSource}
      selected={selectedSection(e, sections)}
      onSelect={selectSection(e, sections)}
      stillOf={e.sectionStill}
      videoUrlOf={e.videoUrlOf}
      onPlay={() => {
        e.setSectionsView("preview")
        e.setSectionPlaying(true)
      }}
      problems={e.sectionProblems}
      onRevert={() => {
        e.setSectionsDraft(null)
        e.setSectionProblems([])
      }}
      onSend={() => {
        void e.gateFor("sections").edit(proposalOf(sections)).then((refused) => {
          e.setSectionProblems(refused)
          if (refused.length === 0) e.setSectionsDraft(null)
        })
      }}
      stages={e.stages}
      gate={e.gateFor("sections")}
      tab={e.sectionsTab}
      onTab={e.setSectionsTab}
    />
    </Panel>
  )
}
