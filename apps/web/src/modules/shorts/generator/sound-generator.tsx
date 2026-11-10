import { useAtomSet } from "@effect/atom-react"
import { SoundCategory, type SoundEffect } from "@viral/contracts"
import { IconButton } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Select } from "@viral/ui/primitives/select"
import { Switch } from "@viral/ui/primitives/switch"
import { Music, Trash2, Type } from "lucide-react"
import { useState } from "react"
import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { deleteSoundEffect, generateSoundEffect } from "../../library/library-api.ts"
import { refusal } from "../../library/library-values.ts"
import { guessCategory, SOUND_MODEL_LABEL, soundCost, type SoundHints, soundLength, soundPrompt } from "./generator-values.ts"
import { GeneratorPreview, GeneratorShell, InputTile, ModelRow, PromptBox, PropertyRow, TakeRow } from "./generator-panel.tsx"

const FOLLOW = { loose: 0.2, balanced: 0.4, close: 0.7 } as const
type Follow = keyof typeof FOLLOW

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`
const CATEGORY_NAMES: Record<SoundCategory, string> = {
  whoosh: "Whoosh", pop: "Pop", click: "Click", tick: "Tick", typing: "Typing", error: "Error", riser: "Riser", impact: "Impact",
  boom: "Boom", scratch: "Record scratch", ding: "Ding", "swoosh-reverse": "Reverse swoosh", glitch: "Glitch", camera: "Camera"
}

// Create › Sound effect (ElevenLabs Sound Effects): a sound from a description, with two hints from the short (the
// word it lands on, the song's tempo), its length, loop, takes and how closely it follows the prompt. Every take is
// kept in the sound library; placing sounds on a short comes with the sound-design plan (decision 17).
export function SoundGenerator({ projectId, word, song }: {
  readonly projectId: string | null
  // the word a sound could land on (the drop word, else none) and the short's song
  readonly word: SoundHints["atWord"]
  readonly song: SoundHints["song"]
}) {
  const generate = useAtomSet(generateSoundEffect, { mode: "promise" })
  const remove = useAtomSet(deleteSoundEffect, { mode: "promise" })
  const [prompt, setPrompt] = useState("")
  const [atWord, setAtWord] = useState(false)
  const [matchSong, setMatchSong] = useState(false)
  const [kind, setKind] = useState<SoundCategory | "auto">("auto")
  const [length, setLength] = useState("")
  const [loop, setLoop] = useState(false)
  const [takes, setTakes] = useState<"1" | "2" | "3" | "4">("2")
  const [follow, setFollow] = useState<Follow>("balanced")
  const [made, setMade] = useState<ReadonlyArray<SoundEffect> | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const hints: SoundHints = { atWord: atWord ? word : null, song: matchSong ? song : null }
  const typed = length.trim() === "" ? null : Number(length)
  const lengthProblem = typed !== null && (!Number.isFinite(typed) || typed < 0.5 || typed > 30) ? "A length is 0.5–30 seconds, or empty for ElevenLabs to pick." : null
  const durationS = lengthProblem === null ? soundLength(typed, hints) : null
  const category = kind === "auto" ? guessCategory(prompt) : kind

  const go = () => {
    setBusy(true)
    setProblem(null)
    void generate({
      payload: { prompt: soundPrompt(prompt, hints), category, durationS, loop, promptInfluence: FOLLOW[follow], takes: Number(takes), projectId },
      reactivityKeys: ["sounds"]
    })
      .then((sounds) => setMade(sounds))
      .catch((e: unknown) => setProblem(refusal(e)[0] ?? "ElevenLabs didn’t make the sound."))
      .finally(() => setBusy(false))
  }
  const drop = (sound: SoundEffect) =>
    void remove({ payload: { id: sound.id }, reactivityKeys: ["sounds"] }).then(() => setMade((list) => list?.filter((s) => s.id !== sound.id) ?? null))

  return (
    <GeneratorShell
      preview={
        <GeneratorPreview state={busy ? "working" : made === null ? "empty" : "done"}>
          {made?.map((s) => (
            <TakeRow
              key={s.id}
              url={homeFileUrl(serverUrl, `sounds/${s.path}`)}
              name={s.name}
              sub={`${s.durationS.toFixed(1)}s · ${CATEGORY_NAMES[s.category]} · in your sound library`}
              actions={<IconButton label={`Delete ${s.name}`} onClick={() => drop(s)}><Trash2 /></IconButton>}
            />
          ))}
          {made !== null && made.length === 0 ? <span className="p-2 text-xs text-fg-2">You deleted every take.</span> : null}
        </GeneratorPreview>
      }
      model={<ModelRow mark="SFX" label={SOUND_MODEL_LABEL} />}
      prompt={<PromptBox value={prompt} onChange={setPrompt} placeholder="A short whoosh that swells into a deep bass hit." />}
      inputs={
        <div className="flex flex-wrap gap-2">
          <InputTile
            icon={<Type />}
            value={word === null ? "No word yet" : `“${word.word}” · ${clock(word.t)}`}
            label="At a word"
            on={atWord}
            {...(word === null ? {} : { onClick: () => setAtWord((v) => !v) })}
          />
          <InputTile
            icon={<Music />}
            value={song === null ? "No song" : `${song.bpm.toFixed(1)} BPM`}
            label="Match the song"
            on={matchSong}
            {...(song === null ? {} : { onClick: () => setMatchSong((v) => !v) })}
          />
        </div>
      }
      properties={
        <>
          <PropertyRow label="Kind">
            <Select<SoundCategory | "auto">
              label="Kind of sound"
              value={kind}
              onChange={setKind}
              options={[{ value: "auto", label: `${CATEGORY_NAMES[guessCategory(prompt)]} (from the words)` }, ...SoundCategory.literals.map((c) => ({ value: c, label: CATEGORY_NAMES[c] }))]}
            />
          </PropertyRow>
          <PropertyRow label="Length">
            <Input aria-label="Length in seconds" className="h-7 w-[84px] text-right" inputMode="decimal" placeholder={durationS === null ? "Auto" : `${durationS}`} value={length} onChange={(e) => setLength(e.currentTarget.value)} />
            <span className="text-xs text-fg-2">s</span>
          </PropertyRow>
          <PropertyRow label="Loop"><Switch label="Loop" checked={loop} onChange={setLoop} /></PropertyRow>
          <PropertyRow label="Takes">
            <Segmented<"1" | "2" | "3" | "4"> label="Takes" value={takes} onChange={setTakes} options={["1", "2", "3", "4"].map((n) => ({ value: n as "1" | "2" | "3" | "4", label: n }))} />
          </PropertyRow>
          <PropertyRow label="Follow the prompt">
            <Segmented<Follow> label="Follow the prompt" value={follow} onChange={setFollow} options={[{ value: "loose", label: "Loose" }, { value: "balanced", label: "Balanced" }, { value: "close", label: "Close" }]} />
          </PropertyRow>
        </>
      }
      cost={soundCost(durationS, Number(takes))}
      problem={problem ?? lengthProblem}
      generate={{ disabled: prompt.trim() === "" || lengthProblem !== null, busy, onClick: go }}
    />
  )
}
