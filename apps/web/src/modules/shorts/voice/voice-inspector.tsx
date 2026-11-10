import { useAtomValue } from "@effect/atom-react"
import type { StageRun, Voice, Voiceover } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Mic, Pause, Play } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { voiceLine } from "../../library/voices/voices-values.ts"
import { voicesAtom } from "../../library/library-api.ts"
import { Detail } from "../../system/detail.tsx"
import { Facts, InspectorBlock } from "../editor-frame.tsx"
import type { GateControls } from "../gate.ts"
import { StepDetails } from "../step-details.tsx"

// The Voice panel: the take's numbers and pace (the style's pace, read-only), your voices (samples are free), and a
// new take in another voice, which costs about as many characters as this one.
export function VoiceInspector({ voiceover, voiceId, stages, gate, onNewVoice }: {
  readonly voiceover: Voiceover
  readonly voiceId: string
  readonly stages: ReadonlyArray<StageRun>
  readonly gate: GateControls
  readonly onNewVoice: (voice: Voice) => void
}) {
  const all = Option.getOrElse(AsyncResult.value(useAtomValue(voicesAtom)), (): ReadonlyArray<Voice> => [])
  // this take's voice first, so you see it without scrolling
  const voices = [...all.filter((v) => v.voiceId === voiceId), ...all.filter((v) => v.voiceId !== voiceId)]
  const [picked, setPicked] = useState<string>(voiceId)
  const [confirming, setConfirming] = useState(false)
  const sample = useRef<HTMLAudioElement | null>(null)
  const [sampling, setSampling] = useState<string | null>(null)
  useEffect(() => () => sample.current?.pause(), [])

  const playSample = (voice: Voice) => {
    if (voice.previewUrl === null) return
    if (sampling === voice.voiceId) {
      sample.current?.pause()
      setSampling(null)
      return
    }
    sample.current?.pause()
    const el = new Audio(voice.previewUrl)
    el.onended = () => setSampling(null)
    sample.current = el
    setSampling(voice.voiceId)
    void el.play().catch(() => setSampling(null))
  }
  const choice = voices.find((v) => v.voiceId === picked)

  return (
    <>
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto px-3.5 pt-1 pb-4">
        <>
            <InspectorBlock title="The take">
              <Facts
                rows={[
                  ["Length", `${voiceover.durationS.toFixed(1)}s`],
                  ["Pace", `${voiceover.pace.toFixed(2)} words/s`],
                  ["Raw take", `${voiceover.rawPace.toFixed(2)} words/s`],
                  ["Sped up", `×${voiceover.atempo}`]
                ]}
              />
              <span className="text-xs text-fg-2">
                The take is sped up or slowed to the style's pace without changing the voice's pitch. Change the pace in the style.
              </span>
              <Detail><span className="text-xs text-fg-2">Model {voiceover.model} · {voiceover.characters} characters</span></Detail>
            </InspectorBlock>
            <InspectorBlock title="Voice">
              <div className="grid gap-px">
                {voices.length === 0 ? <span className="text-xs text-fg-2">Your ElevenLabs voices appear here once a key is saved.</span> : null}
                {voices.map((voice) => (
                  <div
                    key={voice.voiceId}
                    role="radio"
                    aria-checked={voice.voiceId === picked}
                    tabIndex={0}
                    onClick={() => {
                      setPicked(voice.voiceId)
                      setConfirming(false)
                    }}
                    className={cn(
                      "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-ctl px-2.5 py-1.5 hover:bg-ctl",
                      voice.voiceId === picked && "shadow-[inset_0_0_0_1px_var(--lemon)]"
                    )}
                  >
                    <div className="grid min-w-0">
                      <span className="truncate text-sm">{voice.name.split(" - ")[0]}{voice.voiceId === voiceId ? <span className="ml-1.5 text-xs text-fg-3">this take</span> : null}</span>
                      <span className="truncate text-xs text-fg-2">{voiceLine(voice)}</span>
                    </div>
                    <IconButton label={`Play ${voice.name}'s sample`} disabled={voice.previewUrl === null} onClick={(e) => (e.stopPropagation(), playSample(voice))}>
                      {sampling === voice.voiceId ? <Pause /> : <Play />}
                    </IconButton>
                  </div>
                ))}
              </div>
              <span className="text-xs text-fg-2">Samples are free.</span>
            </InspectorBlock>
            {choice === undefined || picked === voiceId ? null : confirming ? (
              <InspectorBlock title={`A new take with ${choice.name.split(" - ")[0]}`}>
                <span className="text-xs text-fg-2">
                  ElevenLabs charges about {voiceover.characters} characters for it, like this take. The script stays as it is.
                </span>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                  <Button variant="primary" disabled={gate.busy} onClick={() => onNewVoice(choice)}>Make the new take</Button>
                </div>
              </InspectorBlock>
            ) : (
              <Button
                className="justify-self-start"
                disabled={gate.request === null}
                title={gate.request === null ? "A new take can be asked for while the voice is waiting for you" : undefined}
                onClick={() => setConfirming(true)}
              >
                <Mic />New take with {choice.name.split(" - ")[0]}
              </Button>
            )}
            <StepDetails stages={stages} names={["voice"]} />
        </>
      </div>
    </>
  )
}
