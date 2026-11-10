import { NothingToInspect, NotYet, StageBar } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { VoiceInspector } from "./voice-inspector.tsx"
import { VoiceStage } from "./voice-stage.tsx"

// The Voice step: the take with its waveform and words on the stage; the voices and pace in the inspector.
export function VoiceStepStage({ e }: { readonly e: EditorState }) {
  const { ws } = e
  if (ws.voiceover === null) return <NotYet e={e} what="voiceover" />
  return (
    <>
      <StageBar e={e} left={`${ws.voiceover.words.length} words spoken`} />
      <div className="min-h-0 flex-1 overflow-auto">
        <VoiceStage
          voiceover={ws.voiceover.voiceover}
          words={ws.voiceover.words}
          url={e.voiceUrl}
          voiceName={e.voiceName}
          pauses={e.layout?.pauses ?? []}
          videos={ws.videos.length}
          onTime={e.onTime}
        />
      </div>
    </>
  )
}

export function VoiceStepPanel({ e }: { readonly e: EditorState }) {
  const { ws } = e
  if (ws.voiceover === null) return <NothingToInspect />
  return (
    <VoiceInspector voiceover={ws.voiceover.voiceover} voiceId={ws.voiceId} stages={e.stages} gate={e.gate} onNewVoice={e.newVoice} tab={e.voiceTab} onTab={e.setVoiceTab} />
  )
}
