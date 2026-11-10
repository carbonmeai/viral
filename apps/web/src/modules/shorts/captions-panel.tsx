import { Button } from "@viral/ui/primitives/button"
import { Palette } from "lucide-react"
import { Facts, InspectorBlock } from "./editor-frame.tsx"
import { captionCues, shortTimeOf } from "./editor-values.ts"
import { Panel, PanelBody } from "./panel.tsx"
import { byRank } from "./ranking/ranking-values.ts"
import { sectionBlocks } from "./sections/sections-values.ts"
import type { EditorState } from "./use-editor-state.ts"

// "0:04.1": a moment on the short's own clock, to a tenth.
const at = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`
const CASE_NAMES = { upper: "CAPITALS", lower: "lower case", "as-spoken": "As spoken" } as const
const where = (y: number) => (y < 0.4 ? "Top" : y < 0.62 ? "Middle" : "Lower")

// The Captions panel (Titles on a ranking), read-only: how the style shows the captions (change them in the style),
// the words the shots agent highlights, and the captions as they'll be shown. A ranking shows its list title and
// each entry's label instead.
export function CaptionsPanel({ e }: { readonly e: EditorState }) {
  const { ws } = e
  const captions = ws.preset.config.captions
  const changeStyle = <Button variant="ghost" onClick={() => e.setPanel("style")}><Palette />Change style</Button>
  if (ws.project.format === "ranking") {
    const ranking = e.rankingPlanDraft
    return (
      <Panel title="Titles" action={changeStyle}>
        <PanelBody>
          {ranking === null ? <span className="text-sm text-fg-2">The titles are written with the ranking.</span> : (
            <>
              <InspectorBlock title="The list at the top">
                <span className="font-[Anton,Impact,sans-serif] text-[17px] tracking-[0.01em] uppercase">
                  {ranking.title.lead} <span className="text-[#ff3b3b]">{ranking.title.accent}</span>
                </span>
              </InspectorBlock>
              <div className="grid gap-1.5">
                {byRank(ranking).map((entry) => (
                  <div key={entry.rank} className="flex min-h-10 items-center gap-2 rounded-[12px] bg-panel px-3 text-sm">
                    <span className="w-5 shrink-0 text-fg-2 tabular-nums">{entry.rank}.</span>
                    <span className="min-w-0 truncate">{entry.label} {entry.emoji}</span>
                  </div>
                ))}
              </div>
              <span className="text-xs text-fg-2">Each clip keeps its own sound and the creator's own captions. Edit a label in Ranks.</span>
            </>
          )}
        </PanelBody>
      </Panel>
    )
  }
  const narrated = ws.project.format === "narrated"
  const layout = e.layout
  const cues = !captions.enabled ? [] : narrated
    ? ws.voiceover === null ? [] : captionCues(ws.voiceover.words, captions, (t) => (layout === null ? t : shortTimeOf(layout, t)))
    : (() => {
      const sections = e.planDraft?.sections ?? []
      const blocks = sectionBlocks(sections)
      return sections.flatMap((s, k) => {
        const words = s.text.split(/\s+/).filter((w) => w !== "").map((w, i) => ({ w, s: i, e: i }))
        return captionCues(words, captions, () => blocks[k]?.start ?? 0).map((cue, i) => ({ ...cue, at: i === 0 ? cue.at : -1 }))
      })
    })()
  const highlights = ws.shotPlan?.plan.highlights.map((h) => (typeof h === "string" ? h : h.word)) ?? []
  return (
    <Panel title="Captions" action={changeStyle}>
      <PanelBody>
        <InspectorBlock title="In this style">
          {captions.enabled ? (
            <Facts
              rows={[
                ["Words at a time", captions.mode === "word" ? "One" : String(captions.maxWords)],
                ["Where", where(captions.y)],
                ["Case", CASE_NAMES[captions.case]],
                ["Highlight", <span key="h" className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block size-3 rounded-[3px] shadow-[0_0_0_1px_var(--line-2)]" style={{ background: captions.highlight }} />{captions.highlight}</span>]
              ]}
            />
          ) : <span className="text-sm text-fg-1">No captions: finish it in an editor from the .srt</span>}
        </InspectorBlock>
        {highlights.length === 0 ? null : (
          <InspectorBlock title="Highlighted words" action={<span className="font-normal text-fg-3">{highlights.length}</span>}>
            <div className="flex flex-wrap gap-1.5">
              {highlights.map((word) => <span key={word} className="inline-flex h-[22px] items-center rounded-chip bg-ctl px-2 text-xs text-fg-1">{word}</span>)}
            </div>
            <span className="text-xs text-fg-2">The shots agent picks these; ask it to change them at the Shots step.</span>
          </InspectorBlock>
        )}
        {cues.length === 0 ? null : (
          <InspectorBlock title="The words, as they'll be shown">
            <div className="grid gap-1.5">
              {cues.map((cue, i) => (
                <div key={i} className="grid min-h-10 grid-cols-[52px_minmax(0,1fr)] items-center gap-2 rounded-[12px] bg-panel px-3 py-1.5">
                  <span className="text-xs text-fg-3 tabular-nums">{cue.at < 0 ? "" : at(cue.at)}</span>
                  <span className="font-[Anton,Impact,sans-serif] text-[14px] tracking-[0.02em]">{cue.text}</span>
                </div>
              ))}
            </div>
          </InspectorBlock>
        )}
      </PanelBody>
    </Panel>
  )
}
