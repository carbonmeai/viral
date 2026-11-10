import { useAtomValue } from "@effect/atom-react"
import type { Preset, Script, ShortVideo } from "@viral/contracts"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { overviewAtom } from "../../home/overview.ts"
import { narrationEnds } from "../editor-values.ts"
import { framesAroundAtom, framesKey } from "../shorts-api.ts"
import { ShotPreview } from "../shots/shot-preview.tsx"
import type { EditorState } from "../use-editor-state.ts"

// The words a line opens with, as its first caption shows them (one word, or the style's chunk).
const firstCaption = (text: string, preset: Preset) =>
  text.split(/\s+/).filter((w) => w !== "").slice(0, preset.config.captions.mode === "word" ? 1 : Math.max(1, preset.config.captions.maxWords)).join(" ")

// The shot that plays when a narration line starts, once the shots are planned.
const shotOfBeat = (e: EditorState, script: Script, beat: number): number | null => {
  const plan = e.ws.shotPlan?.plan
  const words = e.ws.voiceover?.words
  if (plan === undefined || words === undefined || plan.shots.length === 0) return null
  const narration = script.beats.slice(0, beat).filter((b) => b._tag === "Narration").length
  const ends = narrationEnds(script, words)
  const start = narration === 0 ? 0 : (ends[narration - 1] ?? -1) + 1
  const k = plan.shots.findLastIndex((s) => s.word <= start)
  return k === -1 ? 0 : k
}

// A still of one of the short's videos at a second.
function useStill(video: ShortVideo | undefined, t: number, e: EditorState) {
  const frames = useAtomValue(framesAroundAtom(framesKey(video?.source.id ?? e.ws.source.id, t, 0)))
  const frame = Option.getOrNull(AsyncResult.value(frames))?.frames[0] ?? null
  return frame === null ? null : e.videoStillUrl(frame.path, video?.position ?? 0)
}

// The Script step's player: the selected line (else the first) as the short would open it, 9:16, with the style's
// headline and the line's first caption, over its shot once the shots are planned (else a still of its video).
export function ScriptPreview({ e, script }: { readonly e: EditorState; readonly script: Script }) {
  const overview = Option.getOrNull(AsyncResult.value(useAtomValue(overviewAtom)))
  const index = e.beat !== null && script.beats[e.beat] !== undefined ? e.beat : Math.max(0, script.beats.findIndex((b) => b._tag === "Narration"))
  const beat = script.beats[index]
  const real = beat?._tag === "Real" ? beat : null
  // a real line shows its own moment; narration before the shots are planned, a moment from its video's middle
  const first = e.ws.videos[0]
  const still = useStill(e.ws.videos[real?.source ?? 0], real?.start ?? (first === undefined ? 0 : first.seconds * 0.4), e)
  const shot = beat?._tag === "Narration" ? shotOfBeat(e, script, index) : null
  const videoThumb = overview?.videos.find((v) => v.source.id === e.ws.source.id)?.thumb ?? null
  const src = shot !== null && real === null ? e.shotFrame(shot) : still ?? videoThumb
  const preset = e.ws.preset
  const text = beat === undefined ? "" : beat._tag === "Real" ? beat.quote : beat._tag === "Cta" ? beat.question : beat.text
  return (
    <div className="grid min-h-0 flex-1 place-items-center">
      <ShotPreview
        src={src}
        framing={preset.config.framing}
        fit={false}
        cropX={0.5}
        word={firstCaption(text, preset)}
        highlighted={false}
        captions={preset.config.captions}
        headline={script.headline === null || preset.config.headline === null ? null : { lines: script.headline, style: preset.config.headline }}
      />
    </div>
  )
}
