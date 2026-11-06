import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import type { Preset, Voice } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Panel } from "@viral/ui/primitives/panel"
import { Select } from "@viral/ui/primitives/select"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Mic, Pause, Play } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { Page } from "../../layout/page.tsx"
import { Detail } from "../../system/detail.tsx"
import { presetsAtom, previewVoice, updatePreset, voicesAtom } from "../library-api.ts"
import { RowsSkeleton } from "../library-loading.tsx"
import { refusal, stylesByVoice } from "../library-values.ts"

const SAMPLE_LINE = "This guy made a candy that hits every single taste at the exact same time."

// Library › Voices: your ElevenLabs voices, the styles narrating with each, a free sample to play, and a line
// of your own spoken in it (that one costs its characters).
export function VoicesPage() {
  const voices = useAtomValue(voicesAtom)
  const presets = useAtomValue(presetsAtom)
  const styles = Option.getOrElse(AsyncResult.value(presets), (): ReadonlyArray<Preset> => [])
  return (
    <Page title="Voices" description="Your ElevenLabs voices: hear each one, and pick which style narrates with it.">
      {Option.match(AsyncResult.value(voices), {
        onNone: () => AsyncResult.isFailure(voices)
          ? (
            <Panel title="Voices">
              <div className="px-1 py-3">
                <div className="font-medium">Couldn’t list your ElevenLabs voices</div>
                <div className="text-xs text-fg-2">Add or check your ElevenLabs key in <Link to="/settings/accounts" className="underline">Settings › Accounts</Link>.</div>
              </div>
            </Panel>
          )
          : <RowsSkeleton label="Loading your voices" rows={6} />,
        onSome: (list) => (
          <Panel title="Voices" count={list.length}>
            {[...list].sort((a, b) => stylesByVoice(styles, b.voiceId).length - stylesByVoice(styles, a.voiceId).length).map((voice) => (
              <VoiceRow key={voice.voiceId} voice={voice} styles={styles} />
            ))}
          </Panel>
        )
      })}
    </Page>
  )
}

function VoiceRow({ voice, styles }: { readonly voice: Voice; readonly styles: ReadonlyArray<Preset> }) {
  const save = useAtomSet(updatePreset, { mode: "promise" })
  const using = stylesByVoice(styles, voice.voiceId)
  const others = styles.filter((s) => s.config.voice.voiceId !== voice.voiceId)
  const [trying, setTrying] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const name = voice.name.split(" - ")[0] ?? voice.name
  const traits = voice.name.includes(" - ") ? voice.name.split(" - ").slice(1).join(" - ") : Object.values(voice.labels).slice(0, 3).join(", ")

  return (
    <div className="rounded-[8px] bg-item">
      <div className="flex min-h-12 items-center gap-3 px-3 py-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-ctl text-fg-2 [&>svg]:size-4"><Mic /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="font-medium">{name}</span>
            {using.map((s) => <Status key={s.id} tone="ok">{s.name}{s.isDefault ? " · default" : ""}</Status>)}
          </span>
          <span className="truncate text-xs text-fg-2">
            {traits}
            <Detail>{` · ${voice.category ?? "voice"} · ${voice.voiceId}`}</Detail>
          </span>
        </span>
        <Sample url={voice.previewUrl} />
        <Button variant="ghost" onClick={() => setTrying(!trying)}>Try a line</Button>
        {others.length === 0 ? null : (
          <Select<string>
            label={`Use ${name} for a style`}
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
      </div>
      {problem === null ? null : <div className="px-3 pb-2 text-xs text-danger">{problem}</div>}
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
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
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

// ElevenLabs' own sample of a voice, free to play.
function Sample({ url }: { readonly url: string | null }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => audio.current?.pause(), [])
  if (url === null) return null
  const toggle = () => {
    if (audio.current === null) {
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
  return <Button variant="ghost" size="icon" aria-label={playing ? "Stop the sample" : "Play the free sample"} onClick={toggle}>{playing ? <Pause /> : <Play />}</Button>
}

