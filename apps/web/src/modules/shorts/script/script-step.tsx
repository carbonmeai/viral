import { NothingToInspect, NotYet, StageBar } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { ScriptInspector } from "./script-inspector.tsx"
import { ScriptStage } from "./script-stage.tsx"

// The Script step: the script as a document on the stage, its rules, headline and agent in the inspector.
export function ScriptStepStage({ e }: { readonly e: EditorState }) {
  const { ws } = e
  if (ws.script === null) return <NotYet e={e} what="script" />
  return (
    <>
      <StageBar e={e} left={`${ws.script.script.beats.length} lines`} />
      <div className="min-h-0 flex-1 overflow-auto">
        <ScriptStage script={ws.script.script} preset={ws.preset} videoUrlOf={e.videoUrlOf} videos={ws.videos.length} gate={e.gate} selected={e.beat} onSelect={e.setBeat} />
      </div>
    </>
  )
}

export function ScriptStepPanel({ e }: { readonly e: EditorState }) {
  const { ws } = e
  if (ws.script === null) return <NothingToInspect />
  return (
    <ScriptInspector
      script={ws.script.script}
      limits={ws.scriptLimits}
      preset={ws.preset}
      videos={ws.videos.map((v) => v.source.title ?? "Untitled video")}
      stages={e.stages}
      gate={e.gate}
      tab={e.scriptTab}
      onTab={e.setScriptTab}
    />
  )
}
