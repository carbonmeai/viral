import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Preset, Voice } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Status } from "@viral/ui/primitives/status"
import { Skeleton, SkeletonRegion, SkeletonText } from "@viral/ui/primitives/skeleton"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Link } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Search } from "lucide-react"
import { useState } from "react"
import { SampleButton } from "../../library/voices/sample-button.tsx"
import { VoiceRow } from "../../library/voices/voice-row.tsx"
import { pickerVoices, splitName } from "../../library/voices/voices-values.ts"
import { Detail } from "../../system/detail.tsx"
import { presetsAtom, setDefaultVoice, voicesAtom } from "../settings-api.ts"
import { Loaded, Pending, SettingsPage, SettingsSkeleton } from "../settings-page.tsx"

// Settings › Voice: the narrator every short uses unless it picks its own, and how fast it speaks.
export function VoicePage() {
  const presets = useAtomValue(presetsAtom)
  return (
    <SettingsPage section="voice" description="The narrator every short uses unless it picks its own voice.">
      <Loaded result={presets} what="your styles" skeleton={<SettingsSkeleton groups={[2]} titled />}>
        {(list) => {
          const preset = list.find((p) => p.isDefault)
          return preset === undefined ? <Pending>No default style yet.</Pending> : <VoiceSettings preset={preset} />
        }}
      </Loaded>
    </SettingsPage>
  )
}

function VoiceSettings({ preset }: { readonly preset: Preset }) {
  const voices = useAtomValue(voicesAtom)
  const save = useAtomSet(setDefaultVoice, { mode: "promise" })
  const [pace, setPace] = useState(String(preset.config.voice.wordsPerSecond))
  const [saved, setSaved] = useState<string | null>(null)
  const voiceId = preset.config.voice.voiceId

  const store = (next: { readonly voiceId?: string; readonly wordsPerSecond?: number }) =>
    void save({
      payload: { voiceId: next.voiceId ?? voiceId, wordsPerSecond: next.wordsPerSecond ?? preset.config.voice.wordsPerSecond },
      reactivityKeys: ["presets"]
    }).then(() => setSaved("Saved")).catch(() => setSaved("Couldn’t save"))

  const paceValue = Number(pace)
  const paceValid = Number.isFinite(paceValue) && paceValue >= 2 && paceValue <= 5

  return (
    <>
      <SettingsGroup title={`Default style · ${preset.name}`}>
        {Option.match(AsyncResult.value(voices), {
          onNone: () =>
            AsyncResult.isFailure(voices)
              ? (
                <SettingRow
                  label="Voice"
                  sub={<>Couldn’t list your ElevenLabs voices. <Link to="/settings/accounts" className="underline">Add an ElevenLabs key</Link>.</>}
                >
                  <span className="text-fg-2">{voiceId}</span>
                </SettingRow>
              )
              : (
                <SkeletonRegion label="Loading your ElevenLabs voices" className="flex min-h-[60px] items-center gap-3 py-2.5">
                  <Skeleton className="size-9 rounded-full" />
                  <SkeletonText lines={2} className="w-56" />
                  <Skeleton className="ml-auto h-7 w-28 rounded-ctl" />
                </SkeletonRegion>
              ),
          onSome: (list) => <CurrentVoice voices={list} voiceId={voiceId} onPick={(next) => store({ voiceId: next })} />
        })}
        <SettingRow label="Pace" sub={saved ?? "Words per second after speeding up the take. Adam needs about 3.2."}>
          <Input
            aria-label="Words per second"
            inputMode="decimal"
            className="w-[72px] text-right"
            value={pace}
            onChange={(e) => {
              setPace(e.currentTarget.value)
              setSaved(null)
            }}
          />
          <Button disabled={!paceValid || paceValue === preset.config.voice.wordsPerSecond} onClick={() => store({ wordsPerSecond: paceValue })}>
            Save
          </Button>
        </SettingRow>
      </SettingsGroup>
    </>
  )
}

// The default voice as a row, like Library › Voices, with its free sample and Change voice.
function CurrentVoice({ voices, voiceId, onPick }: {
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
      description="The narrator every short uses unless it picks its own. Samples are free."
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
