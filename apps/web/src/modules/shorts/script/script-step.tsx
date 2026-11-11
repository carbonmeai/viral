import { Button } from "@viral/ui/primitives/button"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Pencil } from "lucide-react"
import { narratedWords, realLines } from "../editor-values.ts"
import { Panel } from "../panel.tsx"
import { NothingToInspect, NotYet } from "../step-parts.tsx"
import { nameOf, useShortVideos } from "../short-videos.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { ScriptRules, type ScriptTab } from "./script-inspector.tsx"
import { ScriptPreview } from "./script-preview.tsx"
import { ScriptStage } from "./script-stage.tsx"

// The Script step's player: the selected line as the short would open with it.
export function ScriptStepStage({ e }: { readonly e: EditorState }) {
  if (e.ws.script === null) return <NotYet e={e} what="script" />
  return <ScriptPreview e={e} script={e.ws.script.script} />
}

export const scriptNote = (e: EditorState) => e.ws.script === null ? null : `${e.ws.script.script.beats.length} lines`

// The Script panel: the lines (select one to edit it while the script waits for you) or the rules they're checked
// against, with the counts and Edit at the foot.
export function ScriptStepPanel({ e }: { readonly e: EditorState }) {
  const { ws } = e
  const gate = e.gateFor("script")
  const names = useShortVideos()
  const views = (
    <Segmented<ScriptTab>
      label="Script view"
      value={e.scriptTab}
      onChange={e.setScriptTab}
      options={[{ value: "lines", label: "Lines" }, { value: "rules", label: "Rules" }]}
    />
  )
  if (ws.script === null) return <Panel title="Script"><NothingToInspect /></Panel>
  const script = ws.script.script
  const seconds = ws.voiceover?.voiceover.durationS ?? null
  return (
    <Panel title="Script" action={views}>
      {e.scriptTab === "rules" ? (
        <ScriptRules
          script={script}
          limits={ws.scriptLimits}
          preset={ws.preset}
          videos={ws.videos.map((v) => v.source.title ?? "Untitled video")}
          stages={e.stages}
          gate={gate}
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            <ScriptStage script={script} preset={ws.preset} videoUrlOf={e.videoUrlOf} videos={ws.videos.length} gate={gate} selected={e.beat} onSelect={e.setBeat} editSignal={e.editSignal}
              countdown={ws.scriptLimits?.ranking?.entries ?? null}
              videoName={(v) => nameOf(names, v)}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 px-3.5 py-2.5 shadow-[inset_0_1px_0_var(--line)]">
            <span className="min-w-0 truncate text-xs text-fg-2">
              {narratedWords(script)} words · {realLines(script)} real {realLines(script) === 1 ? "line" : "lines"}{seconds === null ? "" : ` · about ${Math.round(seconds)}s`}
            </span>
            <Button
              className="ml-auto"
              variant="ghost"
              disabled={gate.request === null}
              title={gate.request === null ? "Edits go in while the script is waiting for you" : "Edit the selected line"}
              onClick={e.startEdit}
            >
              <Pencil />Edit
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}
