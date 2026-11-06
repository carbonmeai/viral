import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import type { Preset, Voice } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Select } from "@viral/ui/primitives/select"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { MessageSquareText, Trash2 } from "lucide-react"
import { useState } from "react"
import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { Detail } from "../../system/detail.tsx"
import { previewVoice, removeVoice, updatePreset, voicesAtom } from "../library-api.ts"
import { RowsSkeleton } from "../library-loading.tsx"
import { refusal, stylesByVoice } from "../library-values.ts"
import { SampleButton } from "./sample-button.tsx"
import { initials, splitName } from "./voices-values.ts"

const SAMPLE_LINE = "This guy made a candy that hits every single taste at the exact same time."

// Library › Voices › My voices: the voices on your ElevenLabs account, the styles narrating with each, a free
// sample, a line of your own spoken in it (that one costs its characters), and Remove for voices you added.
export function MyVoicesTab({ styles }: { readonly styles: ReadonlyArray<Preset> }) {
  const voices = useAtomValue(voicesAtom)
  return Option.match(AsyncResult.value(voices), {
    onNone: () => AsyncResult.isFailure(voices)
      ? (
        <div className="rounded-panel bg-panel px-4 py-3">
          <div className="font-medium">Couldn’t list your ElevenLabs voices</div>
          <div className="text-xs text-fg-2">Add or check your ElevenLabs key in <Link to="/settings/accounts" className="underline">Settings › Accounts</Link>.</div>
        </div>
      )
      : <RowsSkeleton label="Loading your voices" rows={6} />,
    onSome: (list) => (
      <div className="flex flex-col">
        <div className="pb-1 text-[13px] text-fg-2">{list.length} voices</div>
        {[...list].sort((a, b) => stylesByVoice(styles, b.voiceId).length - stylesByVoice(styles, a.voiceId).length).map((voice) => (
          <MyVoiceRow key={voice.voiceId} voice={voice} styles={styles} />
        ))}
      </div>
    )
  })
}

function MyVoiceRow({ voice, styles }: { readonly voice: Voice; readonly styles: ReadonlyArray<Preset> }) {
  const save = useAtomSet(updatePreset, { mode: "promise" })
  const remove = useAtomSet(removeVoice, { mode: "promise" })
  const using = stylesByVoice(styles, voice.voiceId)
  const others = styles.filter((s) => s.config.voice.voiceId !== voice.voiceId)
  const [trying, setTrying] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const split = splitName(voice.name)
  const traits = split.traits ?? Object.values(voice.labels).slice(0, 3).join(", ")
  const removable = voice.category !== "premade"

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex min-h-[60px] items-center gap-3 rounded-[10px] px-2 py-2.5 hover:bg-panel">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ctl-active text-[12px] font-semibold text-fg-1">{initials(voice.name)}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium">{split.name}</span>
            {using.map((s) => <Status key={s.id} tone="ok">{s.name}{s.isDefault ? " · default" : ""}</Status>)}
          </span>
          <span className="truncate text-[13px] text-fg-2">
            {traits}
            <Detail>{` · ${voice.category ?? "voice"} · ${voice.voiceId}`}</Detail>
          </span>
        </span>
        {others.length === 0 ? null : (
          <Select<string>
            label={`Use ${split.name} for a style`}
            className="min-w-[150px]"
            value=""
            options={[{ value: "", label: "Use for style…" }, ...others.map((s) => ({ value: s.id, label: s.name }))]}
            onChange={(id) => {
              const style = others.find((s) => s.id === id)
              if (style === undefined) return
              setProblem(null)
              void save({ payload: { id: style.id, config: { ...style.config, voice: { ...style.config.voice, voiceId: voice.voiceId } } }, reactivityKeys: ["presets"] })
                .catch((e: unknown) => setProblem(refusal(e)[0] ?? null))
            }}
          />
        )}
        <span className="flex items-center gap-0.5">
          <IconButton label="Try a line" variant={trying ? "default" : "ghost"} onClick={() => setTrying(!trying)}><MessageSquareText /></IconButton>
          <SampleButton url={voice.previewUrl} name={split.name} />
          {removable ? <IconButton label={`Remove ${split.name}`} onClick={() => setConfirming(true)}><Trash2 /></IconButton> : null}
        </span>
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2.5 text-xs text-fg-1">
          Remove {split.name} from your ElevenLabs account?{using.length === 0 ? "" : ` ${using.map((s) => s.name).join(", ")} narrate${using.length === 1 ? "s" : ""} with it.`}
          <Button
            variant="primary"
            onClick={() => {
              setProblem(null)
              void remove({ payload: { voiceId: voice.voiceId }, reactivityKeys: ["voices"] })
                .catch((e: unknown) => setProblem(refusal(e)[0] ?? "ElevenLabs didn’t remove it."))
                .finally(() => setConfirming(false))
            }}
          >
            Remove
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
        </div>
      ) : null}
      {problem === null ? null : <div className="px-2 pb-2 text-xs text-danger">{problem}</div>}
      {trying ? <TryLine voiceId={voice.voiceId} /> : null}
    </div>
  )
}

// Your own line in this voice. ElevenLabs charges for its characters, so the cost shows before you press it.
function TryLine({ voiceId }: { readonly voiceId: string }) {
  const speak = useAtomSet(previewVoice, { mode: "promise" })
  const [text, setText] = useState(SAMPLE_LINE)
  const [take, setTake] = useState<string | null>(null)
  const [state, setState] = useState<"idle" | "speaking" | "failed">("idle")
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 pb-3 pl-14">
      <Input aria-label="A line to speak" className="min-w-0 flex-1" value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <Button
        disabled={text.trim() === "" || state === "speaking"}
        onClick={() => {
          setState("speaking")
          void speak({ payload: { voiceId, text: text.trim() } })
            .then((result) => {
              setTake(homeFileUrl(serverUrl, `voice-previews/${result.path.split("/").at(-1) ?? ""}`))
              setState("idle")
            })
            .catch(() => setState("failed"))
        }}
      >
        {state === "speaking" ? "Speaking…" : "Speak it"}
      </Button>
      <span className="text-xs text-fg-2">about {text.trim().length} ElevenLabs characters</span>
      {take === null ? null : <audio src={take} controls autoPlay className="h-8 w-full" />}
      {state === "failed" ? <span className="text-xs text-danger">ElevenLabs didn’t speak it. Check your key in Settings › Accounts.</span> : null}
    </div>
  )
}
