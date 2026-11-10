import { Panel } from "../panel.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { GENERATOR_NAMES } from "./generator-values.ts"
import { SoundGenerator } from "./sound-generator.tsx"
import { VoiceGenerator } from "./voice-generator.tsx"

const FROM_NAMES: Partial<Record<EditorState["panel"], string>> = { library: "Library", voice: "Voice" }

// A generator opened over a panel in the editor (Library › Create, the Voice panel's Create), with a crumb back.
export function GeneratorView({ e }: { readonly e: EditorState }) {
  const open = e.generator
  if (open === null) return null
  const back = { label: FROM_NAMES[open.from] ?? "Back", onClick: () => e.setGenerator(null) }
  const narration = e.ws.script?.script.beats.flatMap((b) => (b._tag === "Narration" ? [b.text] : [])) ?? []
  const words = e.ws.voiceover?.words ?? []
  const dropIndex = e.fitted?.bed.dropWord ?? null
  const drop = dropIndex === null ? null : words[dropIndex] ?? null
  const track = e.tracks.find((t) => t.id === e.ws.project.musicTrackId) ?? null
  return (
    <Panel title={GENERATOR_NAMES[open.kind]} back={back}>
      {open.kind === "voice" ? (
        <VoiceGenerator
          projectId={e.ws.project.id}
          narration={narration}
          onSaved={{ label: "Open Voice", onClick: () => (e.setGenerator(null), e.setPanel("voice")) }}
        />
      ) : (
        <SoundGenerator
          projectId={e.ws.project.id}
          word={drop === null ? null : { word: drop.w, t: drop.s }}
          song={track === null || track.bpm === null ? null : { title: track.title, bpm: track.bpm }}
        />
      )}
    </Panel>
  )
}
