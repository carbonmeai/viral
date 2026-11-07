import type { Voice } from "@viral/contracts"
import { Link } from "@tanstack/react-router"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Input } from "@viral/ui/primitives/input"
import { Status } from "@viral/ui/primitives/status"
import { Search } from "lucide-react"
import { useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { SampleButton } from "./sample-button.tsx"
import { VoiceRow } from "./voice-row.tsx"
import { pickerVoices, splitName } from "./voices-values.ts"

// A style's voice as a row, like Library › Voices, with its free sample and Change voice.
export function CurrentVoice({ voices, voiceId, onPick }: {
  readonly voices: ReadonlyArray<Voice>
  readonly voiceId: string
  readonly onPick: (voiceId: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const current = voices.find((v) => v.voiceId === voiceId)
  const name = current === undefined ? voiceId : splitName(current.name).name
  return (
    <div className="-mx-2 py-1">
      <VoiceRow
        voice={current ?? { name: voiceId, category: null, labels: {} }}
        className="hover:bg-transparent"
        detail={current === undefined ? <span> · Not one of your ElevenLabs voices</span> : <Detail>{` · ${current.voiceId}`}</Detail>}
        actions={
          <>
            <SampleButton url={current?.previewUrl ?? null} name={name} />
            <Button onClick={() => setPicking(true)}>Change voice</Button>
          </>
        }
      />
      <VoicePicker
        open={picking}
        onOpenChange={setPicking}
        voices={voices}
        voiceId={voiceId}
        onPick={(next) => {
          setPicking(false)
          if (next !== voiceId) onPick(next)
        }}
      />
    </div>
  )
}

// My voices to choose from, the current one first and marked; Explore has the rest of ElevenLabs' library.
function VoicePicker({ open, onOpenChange, voices, voiceId, onPick }: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly voices: ReadonlyArray<Voice>
  readonly voiceId: string
  readonly onPick: (voiceId: string) => void
}) {
  const [query, setQuery] = useState("")
  const shown = pickerVoices(voices, voiceId, query)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery("")
      }}
      title="Change voice"
      description="The narrator for shorts in this style, unless a short picks its own. Samples are free."
      className="w-[560px]"
      footer={
        <>
          <Link to="/library/voices" className="mr-auto text-sm text-fg-1 underline-offset-2 hover:text-fg hover:underline">Find more voices</Link>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        </>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
        <Input aria-label="Search your voices" placeholder="Search your voices" className="w-full pl-8" value={query} onChange={(e) => setQuery(e.currentTarget.value)} autoFocus />
      </div>
      <div role="radiogroup" aria-label="Your voices" className="-mx-1 flex max-h-[min(420px,calc(100vh-240px))] min-w-0 flex-col gap-px overflow-auto px-1 py-px">
        {shown.length === 0 ? <div className="px-2 py-6 text-center text-sm text-fg-2">No voice matches “{query.trim()}”.</div> : null}
        {shown.map((voice) => {
          const name = splitName(voice.name).name
          const isCurrent = voice.voiceId === voiceId
          return (
            <VoiceRow
              key={voice.voiceId}
              voice={voice}
              selected={isCurrent}
              onSelect={() => onPick(voice.voiceId)}
              badges={isCurrent ? <Status tone="ok">Current</Status> : null}
              actions={<SampleButton url={voice.previewUrl} name={name} />}
            />
          )
        })}
      </div>
    </Dialog>
  )
}
