import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import type { Preset } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button } from "@viral/ui/primitives/button"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { overviewAtom } from "../home/overview.ts"
import { presetsAtom } from "../library/library-api.ts"
import { StylePreview } from "../library/styles/style-preview.tsx"
import { Facts, InspectorBlock } from "./editor-frame.tsx"
import { Panel, PanelBody } from "./panel.tsx"
import { setProjectPreset, startShortRun } from "./shorts-api.ts"
import type { EditorState } from "./use-editor-state.ts"

const CARD = 136

// The Style panel: the styles as cards (the short's own outlined). Picking another re-renders the short in it from
// the layout on, with no agent work, once the steps before the render are approved; before that, the run uses it when
// it gets there. "Edit styles" opens Library › Styles.
export function StylePanel({ e }: { readonly e: EditorState }) {
  const navigate = useNavigate()
  const presets = useAtomValue(presetsAtom)
  const overview = Option.getOrNull(AsyncResult.value(useAtomValue(overviewAtom)))
  const setPreset = useAtomSet(setProjectPreset, { mode: "promise" })
  const start = useAtomSet(startShortRun, { mode: "promise" })
  const [choice, setChoice] = useState<Preset | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const { ws } = e
  const list = Option.getOrNull(AsyncResult.value(presets))
  const frame = (ws.shotPlan === null ? null : e.shotFrame(0)) ?? overview?.videos.find((v) => v.source.id === ws.source.id)?.thumb ?? null
  // the steps before the render are approved, so the short can be laid out again in the new style
  const renderAt = e.steps.findIndex((s) => s.id === "render")
  const laidOut = e.steps.slice(0, renderAt).every((s) => e.states.get(s.id) === "done") && e.ws.render !== null
  const current = ws.preset
  const apply = (preset: Preset) => {
    setBusy(true)
    setFailed(false)
    setPreset({ payload: { id: ws.project.id, presetId: preset.id } })
      .then(() => laidOut ? e.stopRun().then(() => start({ payload: { projectId: ws.project.id, from: "assemble" } })).then(() => undefined) : undefined)
      .then(() => {
        setChoice(null)
        e.refresh()
      })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false))
  }
  const config = current.config
  return (
    <Panel title="Style" action={<Button variant="ghost" onClick={() => void navigate({ to: "/library/styles", search: { edit: current.id } })}>Edit styles</Button>}>
      <PanelBody>
        {list === null ? (
          <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[9/16]" />)}</div>
        ) : (
          <div role="radiogroup" aria-label="Styles" className="grid grid-cols-2 gap-x-2 gap-y-3">
            {list.map((preset) => {
              const on = (choice ?? current).id === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={preset.id === current.id}
                  onClick={() => setChoice(preset.id === current.id ? null : preset)}
                  className="grid min-w-0 content-start gap-1.5 rounded-[10px] text-left outline-none focus-visible:[&>div]:shadow-[0_0_0_1px_var(--lemon)]"
                >
                  <div className={cn("w-fit overflow-hidden rounded-[10px]", on ? "shadow-[0_0_0_1px_var(--lemon)]" : "hover:shadow-[0_0_0_1px_var(--line-2)]")}>
                    <StylePreview config={preset.config} frame={frame} width={CARD} />
                  </div>
                  <span className="truncate text-xs font-medium">{preset.name}{preset.id === current.id ? <span className="ml-1 font-normal text-fg-3">this short</span> : null}</span>
                </button>
              )
            })}
          </div>
        )}
        {choice === null ? null : (
          <InspectorBlock title={`Use ${choice.name}`}>
            <span className="text-xs text-fg-2">
              {laidOut
                ? `The short is laid out and rendered again in ${choice.name}: about 90 seconds, no agent cost.${e.runGoing ? " The run going now is stopped first." : ""}`
                : `The run uses ${choice.name} when it lays the short out.`}
            </span>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setChoice(null)}>Cancel</Button>
              <Button variant="primary" disabled={busy} onClick={() => apply(choice)}>{laidOut ? "Re-render in it" : "Use this style"}</Button>
            </div>
            {failed ? <span className="text-xs text-danger">Couldn't change the style. Is the server running?</span> : null}
          </InspectorBlock>
        )}
        <InspectorBlock title={current.name}>
          <Facts
            rows={[
              ["Captions", config.captions.enabled ? `${config.captions.mode === "word" ? "1 word" : `${config.captions.maxWords} words`} · ${config.captions.y < 0.4 ? "top" : config.captions.y < 0.62 ? "middle" : "lower"}` : "None"],
              ["Headline", config.headline === null ? "None" : "Pinned at the top"],
              ["Framing", config.framing === "band" ? "Band over a blurred fill" : "Crop to fill"],
              ...(ws.project.format === "narrated" ? [["Voice", `${e.voiceName} · ${config.voice.wordsPerSecond} words a second`] as const] : [])
            ]}
          />
        </InspectorBlock>
      </PanelBody>
    </Panel>
  )
}
