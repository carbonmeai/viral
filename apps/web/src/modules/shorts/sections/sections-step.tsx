import { Segmented } from "@viral/ui/primitives/segmented"
import { Eye, LayoutGrid } from "lucide-react"
import { NothingToInspect, NotYet, StyleChips } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { SectionsInspector } from "./sections-inspector.tsx"
import { SectionsStage, type SectionsView } from "./sections-stage.tsx"
import { changeCount, proposalOf, type SectionsDraft } from "./sections-values.ts"

// The selected section, kept inside the draft.
const selectedSection = (e: EditorState, sections: SectionsDraft) => Math.min(e.sectionK, Math.max(0, sections.sections.length - 1))
const selectSection = (e: EditorState, sections: SectionsDraft) => (next: number) => {
  e.setSectionK(Math.max(0, Math.min(sections.sections.length - 1, next)))
  e.setSectionPlaying(false)
}

// The Sections step (cut-down shorts): the selected section playing (or the storyboard) on the stage; the sections,
// the hook and adding a section in the inspector, with your changes collected as one edit.
export function SectionsStepStage({ e }: { readonly e: EditorState }) {
  const sections = e.sections
  if (sections === null || e.ws.cutSource === null) return <NotYet e={e} what="sections" />
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3.5 py-2.5">
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
        <StyleChips e={e} />
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

export function SectionsStepPanel({ e }: { readonly e: EditorState }) {
  const sections = e.sections
  if (sections === null || e.ws.cutSource === null) return <NothingToInspect />
  return (
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
        void e.gate.edit(proposalOf(sections)).then((refused) => {
          e.setSectionProblems(refused)
          if (refused.length === 0) e.setSectionsDraft(null)
        })
      }}
      stages={e.stages}
      gate={e.gate}
      tab={e.sectionsTab}
      onTab={e.setSectionsTab}
    />
  )
}
