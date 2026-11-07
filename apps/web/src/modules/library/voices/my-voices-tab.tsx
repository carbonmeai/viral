import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import type { Preset, Voice } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Input } from "@viral/ui/primitives/input"
import { Menu, MenuItem, MenuSeparator, MenuSub } from "@viral/ui/primitives/menu"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { MessageSquareText, Palette, Star, Trash2 } from "lucide-react"
import { useState } from "react"
import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { Detail } from "../../system/detail.tsx"
import { previewVoice, removeVoice, setDefaultVoice, updatePreset, voicesAtom } from "../library-api.ts"
import { RowsSkeleton } from "../library-loading.tsx"
import { refusal, stylesByVoice } from "../library-values.ts"
import { SampleButton } from "./sample-button.tsx"
import { VoiceRow } from "./voice-row.tsx"
import { splitName } from "./voices-values.ts"

const SAMPLE_LINE = "This guy made a candy that hits every single taste at the exact same time."

// Library › Voices › My voices: the voices on your ElevenLabs account, the default voice (the default style's,
// which every short uses unless its style or the short picks another) tagged, and the other styles narrating with
// each. A row is a free sample and a ⋯ menu: Set as default, Use for style, Try a line (a line of your own spoken
// in it, which costs its characters), and Remove for voices you added.
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
        {byUse(list, styles).map((voice) => (
          <MyVoiceRow key={voice.voiceId} voice={voice} styles={styles} />
        ))}
      </div>
    )
  })
}

// The default style's voice first, then the voices narrating the most styles.
const byUse = (voices: ReadonlyArray<Voice>, styles: ReadonlyArray<Preset>) => {
  const defaultId = styles.find((s) => s.isDefault)?.config.voice.voiceId
  const rank = (v: Voice) => (v.voiceId === defaultId ? 1000 : 0) + stylesByVoice(styles, v.voiceId).length
  return [...voices].sort((a, b) => rank(b) - rank(a))
}

function MyVoiceRow({ voice, styles }: { readonly voice: Voice; readonly styles: ReadonlyArray<Preset> }) {
  const save = useAtomSet(updatePreset, { mode: "promise" })
  const saveDefault = useAtomSet(setDefaultVoice, { mode: "promise" })
  const remove = useAtomSet(removeVoice, { mode: "promise" })
  const using = stylesByVoice(styles, voice.voiceId)
  const defaultStyle = styles.find((s) => s.isDefault)
  const isDefault = defaultStyle?.config.voice.voiceId === voice.voiceId
  // the other styles this voice could narrate; the default style has its own action
  const others = styles.filter((s) => !s.isDefault && s.config.voice.voiceId !== voice.voiceId)
  const [trying, setTrying] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const split = splitName(voice.name)
  const removable = voice.category !== "premade"
  const useFor = (style: Preset) => {
    setProblem(null)
    void save({ payload: { id: style.id, config: { ...style.config, voice: { ...style.config.voice, voiceId: voice.voiceId } } }, reactivityKeys: ["presets"] })
      .catch((e: unknown) => setProblem(refusal(e)[0] ?? null))
  }

  return (
    <div className="border-b border-line last:border-b-0">
      <VoiceRow
        voice={voice}
        badges={
          <>
            {isDefault ? <Status tone="ok">Default</Status> : null}
            {using.filter((s) => !s.isDefault).map((s) => <Status key={s.id}>{s.name}</Status>)}
          </>
        }
        detail={<Detail><span className="text-fg-3">{` · ${voice.voiceId}`}</span></Detail>}
        actions={
          <span className="flex items-center gap-0.5">
            <SampleButton url={voice.previewUrl} name={split.name} />
            <Menu label={`More for ${split.name}`}>
              {defaultStyle === undefined || isDefault ? null : (
                <MenuItem
                  onClick={() => {
                    setProblem(null)
                    void saveDefault({ payload: { voiceId: voice.voiceId, wordsPerSecond: defaultStyle.config.voice.wordsPerSecond }, reactivityKeys: ["presets"] })
                      .catch((e: unknown) => setProblem(refusal(e)[0] ?? "Couldn’t set it as the default voice."))
                  }}
                >
                  <Star />Set as default
                </MenuItem>
              )}
              {others.length === 0 ? null : (
                <MenuSub label={<><Palette />Use for style</>}>
                  {others.map((s) => <MenuItem key={s.id} onClick={() => useFor(s)}><span className="truncate">{s.name}</span></MenuItem>)}
                </MenuSub>
              )}
              <MenuItem onClick={() => setTrying(true)}><MessageSquareText />Try a line</MenuItem>
              {removable ? (
                <>
                  <MenuSeparator />
                  <MenuItem tone="danger" onClick={() => setConfirming(true)}><Trash2 />Remove</MenuItem>
                </>
              ) : null}
            </Menu>
          </span>
        }
      />
      {problem === null ? null : <div className="px-2 pb-2 text-xs text-danger">{problem}</div>}
      {trying ? <TryLine voiceId={voice.voiceId} onClose={() => setTrying(false)} /> : null}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${split.name}?`}
        description={`It’s removed from your ElevenLabs account.${using.length === 0 ? "" : ` ${using.map((s) => s.name).join(", ")} narrate${using.length === 1 ? "s" : ""} with it.`}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false)
                setProblem(null)
                void remove({ payload: { voiceId: voice.voiceId }, reactivityKeys: ["voices"] })
                  .catch((e: unknown) => setProblem(refusal(e)[0] ?? "ElevenLabs didn’t remove it."))
              }}
            >
              Remove
            </Button>
          </>
        }
      />
    </div>
  )
}

// Your own line in this voice. ElevenLabs charges for its characters, so the cost shows before you press it.
function TryLine({ voiceId, onClose }: { readonly voiceId: string; readonly onClose: () => void }) {
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
      <Button variant="ghost" onClick={onClose}>Close</Button>
      {take === null ? null : <audio src={take} controls autoPlay className="h-8 w-full" />}
      {state === "failed" ? <span className="text-xs text-danger">ElevenLabs didn’t speak it. Check your key in Settings › Accounts.</span> : null}
    </div>
  )
}
