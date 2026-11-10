import { useAtomSet } from "@effect/atom-react"
import type { DesignedVoices } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Check, Quote } from "lucide-react"
import { useState } from "react"
import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { designVoice, saveDesignedVoice } from "../../library/library-api.ts"
import { refusal } from "../../library/library-values.ts"
import { defaultVoiceLine, VOICE_MODEL_LABEL, voiceCheck } from "./generator-values.ts"
import { GeneratorPreview, GeneratorShell, InputTile, ModelRow, PromptBox, PropertyRow, TakeRow } from "./generator-panel.tsx"

const previewUrl = (path: string) => homeFileUrl(serverUrl, `voice-previews/${path.split("/").at(-1) ?? ""}`)

// Create › Voice: a voice designed from your description (ElevenLabs Voice Design). It makes three takes of the line
// to speak (the script's first lines, or a sample); play them, name the one you like and save it to My voices. Nothing
// is added to your ElevenLabs account until you click Save, and voices are never cloned from a clip (decision 18).
export function VoiceGenerator({ projectId, narration, onSaved }: {
  readonly projectId: string | null
  // the short's narration, line by line, for the default line to speak
  readonly narration: ReadonlyArray<string>
  // after a save (the editor offers to open the Voice panel)
  readonly onSaved?: { readonly label: string; readonly onClick: () => void }
}) {
  const design = useAtomSet(designVoice, { mode: "promise" })
  const save = useAtomSet(saveDesignedVoice, { mode: "promise" })
  const [description, setDescription] = useState("")
  const [line, setLine] = useState(() => defaultVoiceLine(narration))
  const [editingLine, setEditingLine] = useState(false)
  const [made, setMade] = useState<DesignedVoices | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const check = voiceCheck(description, line)

  const generate = () => {
    setBusy(true)
    setProblem(null)
    setChosen(null)
    setSaved(null)
    void design({ payload: { description: description.trim(), text: line.trim(), projectId } })
      .then((result) => setMade(result))
      .catch((e: unknown) => setProblem(refusal(e)[0] ?? "ElevenLabs didn’t make the voices."))
      .finally(() => setBusy(false))
  }
  const keep = () => {
    if (chosen === null) return
    setSaving(true)
    setProblem(null)
    void save({ payload: { previewId: chosen, name: name.trim() || "Designed voice", description: description.trim() }, reactivityKeys: ["voices"] })
      .then((voice) => setSaved(voice.name))
      .catch((e: unknown) => setProblem(refusal(e)[0] ?? "Couldn’t save the voice."))
      .finally(() => setSaving(false))
  }

  return (
    <GeneratorShell
      preview={
        <GeneratorPreview state={busy ? "working" : made === null ? "empty" : "done"}>
          {made?.previews.map((p, i) => (
            <TakeRow
              key={p.previewId}
              url={previewUrl(p.path)}
              name={`Voice ${i + 1}`}
              sub={[p.durationS === null ? null : `${p.durationS.toFixed(1)}s`, p.language].filter((x) => x !== null).join(" · ") || "A take of your line"}
              selected={chosen === p.previewId}
              actions={
                <Button variant={chosen === p.previewId ? "default" : "ghost"} onClick={() => setChosen(p.previewId)} disabled={saved !== null}>
                  {chosen === p.previewId ? <><Check />Chosen</> : "Choose"}
                </Button>
              }
            />
          ))}
          {made === null ? null : chosen === null ? (
            <span className="px-1.5 pt-1 text-xs text-fg-2">Play them, then choose the one to keep. They’re previews: nothing is on your account yet.</span>
          ) : saved !== null ? (
            <div className="flex items-center gap-2 px-1.5 pt-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-fg-1"><Check className="mr-1 inline size-3 text-ok" />Saved to My voices as {saved}</span>
              {onSaved === undefined ? null : <Button onClick={onSaved.onClick}>{onSaved.label}</Button>}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-1.5 pt-1.5">
              <Input aria-label="Name for the voice" className="h-7 min-w-0 flex-1" placeholder="Name it, e.g. Warm narrator" value={name} onChange={(e) => setName(e.currentTarget.value)} />
              <Button variant="primary" disabled={saving} onClick={keep}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          )}
        </GeneratorPreview>
      }
      model={<ModelRow mark="v3" label={VOICE_MODEL_LABEL} />}
      prompt={<PromptBox value={description} onChange={setDescription} placeholder="A warm, fast American narrator in his 30s. Curious, a little amazed, never shouting." />}
      inputs={
        <>
          <div className="flex flex-wrap gap-2">
            <InputTile icon={<Quote />} value={`“${line.slice(0, 18)}…”`} label="Line to speak" on={editingLine} onClick={() => setEditingLine((v) => !v)} />
          </div>
          {editingLine ? (
            <textarea
              aria-label="Line to speak"
              value={line}
              rows={4}
              onChange={(e) => setLine(e.currentTarget.value)}
              className="w-full resize-y rounded-[10px] bg-panel px-3 py-2 text-sm leading-[1.5] text-fg outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--lemon)]"
            />
          ) : null}
        </>
      }
      properties={
        <>
          <PropertyRow label="Takes"><span className="text-sm text-fg-2">3</span></PropertyRow>
          <PropertyRow label="Language"><span className="text-sm text-fg-2">The line’s own</span></PropertyRow>
        </>
      }
      cost={check.cost}
      problem={problem ?? (description.trim() === "" ? null : check.problem)}
      generate={{ disabled: check.problem !== null, busy, onClick: generate }}
    />
  )
}
