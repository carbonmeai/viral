import { Panel } from "../panel.tsx"
import { NothingToInspect, NotYet } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { VoiceInspector } from "./voice-inspector.tsx"
import { VoiceStage } from "./voice-stage.tsx"

// The Voice step's player: the take with its waveform, following the words as they're spoken.
export function VoiceStepStage({ e }: { readonly e: EditorState }) {
  const { ws } = e
  if (ws.voiceover === null) return <NotYet e={e} what="voiceover" />
  return (
    <div className="grid min-h-0 flex-1 overflow-auto">
      <div className="self-center">
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
    </div>
  )
}

export const voiceNote = (e: EditorState) => e.ws.voiceover === null ? null : `${e.ws.voiceover.words.length} words spoken`

// The Voice panel: the take and its pace, your voices, and a new take in another one.
export function VoiceStepPanel({ e }: { readonly e: EditorState }) {
  const { ws } = e
  return (
    <Panel title="Voice">
      {ws.voiceover === null
        ? <NothingToInspect />
        : <VoiceInspector voiceover={ws.voiceover.voiceover} voiceId={ws.voiceId} stages={e.stages} gate={e.gateFor("voice")} onNewVoice={e.newVoice} />}
    </Panel>
  )
}
