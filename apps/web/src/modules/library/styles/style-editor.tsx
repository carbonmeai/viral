import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import type { Preset, PresetConfig, Project } from "@viral/contracts"
import { Button, buttonVariants } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Select } from "@viral/ui/primitives/select"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Skeleton, SkeletonRegion, SkeletonText } from "@viral/ui/primitives/skeleton"
import { Status } from "@viral/ui/primitives/status"
import { Switch } from "@viral/ui/primitives/switch"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { plural } from "../../../lib/format.ts"
import { Page } from "../../layout/page.tsx"
import { Detail } from "../../system/detail.tsx"
import { renamePreset, updatePreset, voicesAtom } from "../library-api.ts"
import { refusal } from "../library-values.ts"
import { CurrentVoice } from "../voices/voice-picker.tsx"
import { ColourField, RangeField } from "./style-fields.tsx"
import { StylePreview } from "./style-preview.tsx"

const EDITOR_PREVIEW = 300
const percent = (v: number) => `${Math.round(v * 100)}%`

// Editing one style: its picture on the left changes as you edit; the settings on the right save together.
// The server checks every value and says what's wrong if it refuses.
export function StyleEditor({ preset, frame, usedBy }: { readonly preset: Preset; readonly frame: string | null; readonly usedBy: ReadonlyArray<Project> }) {
  const save = useAtomSet(updatePreset, { mode: "promise" })
  const rename = useAtomSet(renamePreset, { mode: "promise" })
  const [draft, setDraft] = useState<PresetConfig>(preset.config)
  const [name, setName] = useState(preset.name)
  const [problems, setProblems] = useState<ReadonlyArray<string>>([])
  const [saved, setSaved] = useState(false)
  const changed = JSON.stringify(draft) !== JSON.stringify(preset.config) || name.trim() !== preset.name

  const edit = (next: Partial<PresetConfig>) => {
    setDraft((d) => ({ ...d, ...next }))
    setSaved(false)
  }
  const captions = (next: Partial<PresetConfig["captions"]>) => edit({ captions: { ...draft.captions, ...next } })
  const music = (next: Partial<PresetConfig["music"]>) => edit({ music: { ...draft.music, ...next } })
  const voice = (next: Partial<PresetConfig["voice"]>) => edit({ voice: { ...draft.voice, ...next } })

  const store = async () => {
    setProblems([])
    try {
      if (name.trim() !== preset.name) await rename({ payload: { id: preset.id, name }, reactivityKeys: ["presets"] })
      if (JSON.stringify(draft) !== JSON.stringify(preset.config)) await save({ payload: { id: preset.id, config: draft }, reactivityKeys: ["presets"] })
      setSaved(true)
    } catch (e) {
      setProblems(refusal(e))
    }
  }

  return (
    <Page
      title={preset.name}
      description={`${preset.isDefault ? "The default style" : "A style"} · used by ${plural(usedBy.length, "short")}`}
      actions={
        <>
          <Link to="/library/styles" search={{}} className={buttonVariants({ variant: "ghost", size: "md" })}><ArrowLeft />All styles</Link>
          {changed ? <Button size="md" variant="ghost" onClick={() => {
            setDraft(preset.config)
            setName(preset.name)
            setProblems([])
          }}>Revert</Button> : null}
          <Button size="md" variant="primary" disabled={!changed} onClick={() => void store()}>{saved && !changed ? "Saved" : "Save"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-6">
        <div className="sticky top-0 flex flex-col items-center gap-2">
          <StylePreview config={draft} frame={frame} width={EDITOR_PREVIEW} />
          <span className="text-xs text-fg-2">A frame from one of your shorts, in this style</span>
        </div>

        <div className="grid gap-5">
          {problems.length === 0 ? null : (
            <div className="rounded-panel bg-panel px-4 py-3 text-danger">
              <div className="font-medium">Not saved</div>
              <ul className="m-0 mt-1 pl-4 text-xs">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}

          <SettingsGroup title="Name">
            <SettingRow label="Style name" sub="Shown in the style picker and on each short.">
              <Input aria-label="Style name" className="w-[220px]" value={name} onChange={(e) => {
                setName(e.currentTarget.value)
                setSaved(false)
              }} />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title="Look">
            <SettingRow label="Framing" sub="Band keeps a sharp strip over a blurred fill; full-bleed crops the footage to fill the screen.">
              <Segmented label="Framing" value={draft.framing} onChange={(framing) => edit({ framing })} options={[{ value: "band", label: "Band" }, { value: "full", label: "Full-bleed" }]} />
            </SettingRow>
            <SettingRow label="Headline" sub="The open loop pinned at the top, written by the script step.">
              <Switch label="Headline" checked={draft.headline !== null} onChange={(on) => edit({ headline: on ? { colors: ["#FF2A2A", "#FFFFFF"], y: 0.035, size: 0.13 } : null })} />
            </SettingRow>
            {draft.headline === null ? null : (
              <>
                <SettingRow label="Headline colours" sub="First line, second line.">
                  <ColourField label="Headline line 1" value={draft.headline.colors[0]} onChange={(c) => edit({ headline: { ...draft.headline!, colors: [c, draft.headline!.colors[1]] } })} />
                  <ColourField label="Headline line 2" value={draft.headline.colors[1]} onChange={(c) => edit({ headline: { ...draft.headline!, colors: [draft.headline!.colors[0], c] } })} />
                </SettingRow>
                <SettingRow label="Headline size">
                  <RangeField label="Headline size" value={draft.headline.size} min={0.04} max={0.2} step={0.005} format={percent} onChange={(size) => edit({ headline: { ...draft.headline!, size } })} />
                </SettingRow>
              </>
            )}
            <SettingRow label="Labels" sub="Small words on screen naming what you're looking at (“STICKY”).">
              <Switch label="Labels" checked={draft.labels} onChange={(labels) => edit({ labels })} />
            </SettingRow>
            <SettingRow label="Credit" sub="“Video: <channel>” when the footage isn't yours.">
              <Switch label="Credit" checked={draft.credit} onChange={(credit) => edit({ credit })} />
            </SettingRow>
            <SettingRow label="Ranking credit" sub="Rankings: a small “via <channel>” under each clip. Off, every channel is in the description.">
              <Switch label="Ranking credit" checked={draft.rankingVia === true} onChange={(rankingVia) => edit({ rankingVia })} />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title="Captions">
            <SettingRow label="Captions" sub="Off when you finish the short in an editor like CapCut from the mp4 and srt.">
              <Switch label="Captions" checked={draft.captions.enabled} onChange={(enabled) => captions({ enabled })} />
            </SettingRow>
            <SettingRow label="Words at a time">
              <Segmented
                label="Caption mode"
                value={draft.captions.mode}
                onChange={(mode) => captions({ mode, maxWords: mode === "word" ? 1 : Math.max(2, draft.captions.maxWords) })}
                options={[{ value: "word", label: "One" }, { value: "chunk", label: "A few" }]}
              />
              {draft.captions.mode === "chunk" ? (
                <Select label="Words per caption" className="min-w-[72px]" value={String(draft.captions.maxWords)} onChange={(n) => captions({ maxWords: Number(n) })} options={["2", "3", "4", "5"].map((n) => ({ value: n, label: n }))} />
              ) : null}
            </SettingRow>
            <SettingRow label="Case">
              <Segmented label="Caption case" value={draft.captions.case} onChange={(c) => captions({ case: c })} options={[{ value: "lower", label: "lower" }, { value: "upper", label: "UPPER" }, { value: "as-spoken", label: "As spoken" }]} />
            </SettingRow>
            <SettingRow label="Highlight" sub="The colour of the key word. Words the shots step picks keep their own colours.">
              <ColourField label="Caption highlight" value={draft.captions.highlight} onChange={(highlight) => captions({ highlight })} />
            </SettingRow>
            <SettingRow label="Position" sub="How far down the screen the captions sit.">
              <RangeField label="Caption position" value={draft.captions.y} min={0.1} max={0.95} step={0.01} format={percent} onChange={(y) => captions({ y })} />
            </SettingRow>
            <SettingRow label="Quote box" sub="The creator's real lines in a box, so viewers see who's talking.">
              <Switch label="Quote box" checked={draft.captions.quoteBox} onChange={(quoteBox) => captions({ quoteBox })} />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title="Voice">
            <StyleVoice voiceId={draft.voice.voiceId} onChange={(voiceId) => voice({ voiceId })} />
            <SettingRow label="Pace" sub="Words per second after speeding up the take. About 3.2 suits most narrators.">
              <RangeField label="Words per second" value={draft.voice.wordsPerSecond} min={2} max={5} step={0.1} format={(v) => `${v.toFixed(1)}/s`} onChange={(wordsPerSecond) => voice({ wordsPerSecond })} />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title="Music and sound">
            <SettingRow label="Music level" sub="Under the narration. Music is optional: a short without a track is voice only.">
              <RangeField label="Music level" value={draft.music.gain} min={0} max={1} step={0.01} format={percent} onChange={(gain) => music({ gain })} />
            </SettingRow>
            <SettingRow label="After the drop" sub="How loud the music comes in when it drops.">
              <RangeField label="Music after the drop" value={draft.music.dropGain} min={0} max={1} step={0.01} format={percent} onChange={(dropGain) => music({ dropGain })} />
            </SettingRow>
            <Detail>
              <SettingRow label="Loudness" sub="The finished short's loudness. YouTube plays shorts at about -14 LUFS.">
                <RangeField label="Loudness" value={draft.loudnessLufs} min={-30} max={-6} step={1} format={(v) => `${v} LUFS`} onChange={(loudnessLufs) => edit({ loudnessLufs })} />
              </SettingRow>
              <SettingRow label="Ducking" sub="How much the music dips while someone speaks.">
                <RangeField label="Ducking ratio" value={draft.music.duckRatio} min={1} max={20} step={0.5} format={(v) => `${v}:1`} onChange={(duckRatio) => music({ duckRatio })} />
              </SettingRow>
            </Detail>
          </SettingsGroup>

          <Detail>
            <SettingsGroup title="Pace of cuts">
              <SettingRow label="Average shot" sub="A guide for the shots step: about 1.3s for a fast recap, 2.2s for an interleaved short.">
                <RangeField label="Average shot length" value={draft.pace.shotSeconds} min={0.6} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(shotSeconds) => edit({ pace: { shotSeconds } })} />
              </SettingRow>
            </SettingsGroup>
          </Detail>

          {usedBy.length === 0 ? null : (
            <SettingsGroup title="Used by">
              {usedBy.map((p) => (
                <SettingRow key={p.id} label={p.title} sub={p.approach}>
                  <Link to="/shorts/$projectId" params={{ projectId: p.id }} className={buttonVariants({ variant: "ghost" })}>Open</Link>
                </SettingRow>
              ))}
            </SettingsGroup>
          )}
        </div>
      </div>
    </Page>
  )
}

// The narrator, picked from your ElevenLabs voices with a free sample of each; a skeleton while the list loads.
function StyleVoice({ voiceId, onChange }: { readonly voiceId: string; readonly onChange: (voiceId: string) => void }) {
  const voices = useAtomValue(voicesAtom)
  return Option.match(AsyncResult.value(voices), {
    onNone: () =>
      AsyncResult.isFailure(voices)
        ? (
          <SettingRow
            label="Voice"
            sub={<>Couldn’t list your ElevenLabs voices. Check the key in <Link to="/settings/accounts" className="underline">Settings › Accounts</Link>.</>}
          >
            <Status>{voiceId}</Status>
          </SettingRow>
        )
        : (
          <SkeletonRegion label="Loading your ElevenLabs voices" className="flex min-h-[60px] items-center gap-3 py-2.5">
            <Skeleton className="size-9 rounded-full" />
            <SkeletonText lines={2} className="w-56" />
            <Skeleton className="ml-auto h-7 w-28 rounded-ctl" />
          </SkeletonRegion>
        ),
    onSome: (list) => <CurrentVoice voices={list} voiceId={voiceId} onPick={onChange} />
  })
}
