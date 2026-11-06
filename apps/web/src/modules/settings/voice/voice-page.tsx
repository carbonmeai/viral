import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Preset, Voice } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Select } from "@viral/ui/primitives/select"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Link } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Pause, Play } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { presetsAtom, setDefaultVoice, voicesAtom } from "../settings-api.ts"
import { Loaded, Pending, SettingsPage } from "../settings-page.tsx"

const describeVoice = (voice: Voice) => {
  const labels = Object.values(voice.labels).slice(0, 3).join(", ")
  return labels === "" ? voice.category ?? "" : labels
}

// Settings › Voice: the narrator every short uses unless it picks its own, and how fast it speaks.
export function VoicePage() {
  const presets = useAtomValue(presetsAtom)
  return (
    <SettingsPage section="voice" description="The narrator every short uses unless it picks its own voice.">
      <Loaded result={presets} what="your styles">
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
          onNone: () => (
            <SettingRow
              label="Voice"
              sub={AsyncResult.isFailure(voices)
                ? <>Couldn’t list your ElevenLabs voices. <Link to="/settings/accounts" className="underline">Add an ElevenLabs key</Link>.</>
                : "Loading your ElevenLabs voices…"}
            >
              <span className="text-fg-2">{voiceId}</span>
            </SettingRow>
          ),
          onSome: (list) => {
            const current = list.find((v) => v.voiceId === voiceId)
            const options = (current === undefined ? [{ voiceId, name: voiceId, category: null, description: null, labels: {}, previewUrl: null }, ...list] : list)
              .map((v) => ({ value: v.voiceId, label: v.name.split(" - ")[0] ?? v.name, note: describeVoice(v) }))
            return (
              <SettingRow label="Voice" sub={current === undefined ? "Not one of your ElevenLabs voices" : describeVoice(current)}>
                <Sample url={current?.previewUrl ?? null} />
                <Select label="Voice" className="min-w-[200px]" value={voiceId} options={options} onChange={(next) => store({ voiceId: next })} />
              </SettingRow>
            )
          }
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

// ElevenLabs' own sample of a voice, free to play.
function Sample({ url }: { readonly url: string | null }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => audio.current?.pause(), [])
  if (url === null) return null
  const toggle = () => {
    if (audio.current === null || audio.current.src !== url) {
      audio.current?.pause()
      audio.current = new Audio(url)
      audio.current.onended = () => setPlaying(false)
    }
    if (playing) {
      audio.current.pause()
      setPlaying(false)
    } else {
      void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }
  return (
    <Button variant="ghost" size="icon" aria-label={playing ? "Stop the sample" : "Play a sample"} title={playing ? "Stop the sample" : "Play a sample"} onClick={toggle}>
      {playing ? <Pause /> : <Play />}
    </Button>
  )
}
