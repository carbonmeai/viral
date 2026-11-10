import { useAtomValue } from "@effect/atom-react"
import type { GeneratedThumbnail, StageRun } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button } from "@viral/ui/primitives/button"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { clockOf } from "../editor-values.ts"
import { Facts, InspectorBlock } from "../editor-frame.tsx"
import type { GateControls } from "../gate.ts"
import { accountsAtom } from "../../settings/settings-api.ts"
import { StepDetails } from "../step-details.tsx"
import { inputNames, optionInUse, optionNote } from "./thumbnail-values.ts"

// a file of the thumbnail's version (its options and real frames), as a URL
export type ThumbnailFileUrl = (file: string) => string

// The AI round on the stage: its options side by side, each in a phone frame at the size a viewer scrolling past sees
// it, the one in use outlined. At the gate each one can be used (that approves it); a refused option says why.
export function ThumbnailOptionsStage({ generated, fileUrl, gate }: {
  readonly generated: GeneratedThumbnail
  readonly fileUrl: ThumbnailFileUrl
  readonly gate: GateControls
}) {
  const inUse = optionInUse(generated)
  if (generated.options.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
        <p className="max-w-[420px] text-sm text-fg-1">{generated.heldBack ?? "No options were made."}</p>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-4 overflow-x-auto px-5 py-1.5">
      {generated.options.map((o, i) => {
        const n = i + 1
        const used = inUse === n
        return (
          <figure key={n} className="m-0 flex h-full max-h-[560px] min-w-0 flex-col items-center gap-2">
            <div
              className={cn(
                "relative aspect-[9/16] min-h-0 flex-1 overflow-hidden rounded-[14px] bg-black shadow-[0_0_0_1px_var(--line-2)]",
                used && "shadow-[0_0_0_2px_var(--lemon)]"
              )}
            >
              {o.image === null
                ? <span className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-white/70">{o.failure ?? "Not made."}</span>
                : <img src={fileUrl(o.image)} alt={`Option ${n}`} className="absolute inset-0 size-full object-cover" />}
              <span className="absolute top-2 left-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] text-white">
                {n}
                {generated.chosen === n ? " · chosen" : generated.recommended === n ? " · agent's pick" : ""}
              </span>
            </div>
            <figcaption className="flex items-center gap-2 text-xs text-fg-2">
              <span className="max-w-[170px] truncate" title={optionNote(o)}>{o.image === null ? "Not made" : optionNote(o)}</span>
              {gate.request === null || o.image === null ? null : (
                <Button size="sm" variant={used ? "primary" : "ghost"} disabled={gate.busy} onClick={() => void gate.edit({ choose: n })}>
                  Use this
                </Button>
              )}
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}

// The Thumbnail panel's Options view for an AI round: the real frames it was made from (numbered as the image model
// saw them), each option's face check (or why it wasn't made), and the round's model and credits.
export function ThumbnailOptionsPanel({ generated, fileUrl, gate, stages }: {
  readonly generated: GeneratedThumbnail
  readonly fileUrl: ThumbnailFileUrl
  readonly gate: GateControls
  readonly stages: ReadonlyArray<StageRun>
}) {
  const names = inputNames(generated.inputs)
  const inUse = optionInUse(generated)
  return (
    <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto px-3.5 pt-1 pb-4">
      {generated.heldBack == null ? null : <p className="m-0 rounded-[10px] bg-panel p-3 text-sm text-fg-1">{generated.heldBack}</p>}
      <InspectorBlock title="Options">
        <div className="grid gap-1.5">
          {generated.options.map((o, i) => (
            <div key={i} className={cn("flex items-center gap-2.5 rounded-ctl p-1.5", inUse === i + 1 ? "bg-sel" : "")}>
              <div className="aspect-[9/16] w-10 shrink-0 overflow-hidden rounded-[5px] bg-ctl-active">
                {o.image === null ? null : <img src={fileUrl(o.image)} alt="" className="size-full object-cover" />}
              </div>
              <span className="grid min-w-0 flex-1">
                <span className="text-sm">Option {i + 1}{generated.chosen === i + 1 ? " · chosen" : generated.recommended === i + 1 ? " · agent's pick" : ""}</span>
                <span className="text-xs text-fg-2">{optionNote(o)}</span>
              </span>
              {gate.request === null || o.image === null ? null : (
                <Button size="sm" variant="ghost" disabled={gate.busy} onClick={() => void gate.edit({ choose: i + 1 })}>Use</Button>
              )}
            </div>
          ))}
        </div>
        <span className="text-xs text-fg-2">
          {gate.request === null
            ? "Options can be chosen while the thumbnail is waiting for you."
            : "Use one to approve it, or ask for another round with a note in Generate."}
        </span>
      </InspectorBlock>
      <InspectorBlock title="Made from real frames">
        <div className="grid grid-cols-2 gap-2">
          {generated.inputs.map((input, i) => (
            <div key={input.file} className="grid gap-1">
              <div className="aspect-video overflow-hidden rounded-[6px] bg-ctl-active">
                <img src={fileUrl(input.file)} alt={names[i]} className="size-full object-cover" />
              </div>
              <span className="text-xs text-fg-2">{i + 1}. {names[i]} · {clockOf(input.src)}</span>
            </div>
          ))}
        </div>
      </InspectorBlock>
      <InspectorBlock title="Round">
        <Facts
          rows={[
            ["Words", generated.design.words],
            ["Image model", generated.model],
            ["Credits", generated.credits === 0 ? "None" : `about ${generated.credits.toLocaleString("en-US")}`]
          ]}
        />
      </InspectorBlock>
      <StepDetails stages={stages} names={["thumbnail"]} />
    </div>
  )
}

// Whether thumbnails can be made by the image model: an ElevenLabs key is set in Settings › Accounts (or the
// environment). Unknown while the accounts load.
export function useImageKey(): boolean | null {
  const accounts = Option.getOrNull(AsyncResult.value(useAtomValue(accountsAtom)))
  return accounts === null ? null : accounts.some((a) => a.name === "elevenlabs" && a.status === "ready")
}

// Said on a basic thumbnail (drawn by Viral, Decision 8): why it isn't an AI one.
export function BasicNote({ imageKey }: { readonly imageKey: boolean | null }) {
  return (
    <p className="m-0 rounded-[10px] bg-panel px-3 py-2 text-xs text-fg-1">
      {imageKey === false
        ? "Basic thumbnail, drawn by Viral. Add an ElevenLabs key (Pro plan) in Settings › Accounts for AI thumbnails made from real frames."
        : "Basic thumbnail, drawn by Viral. Ask for another round to have the image model make it from real frames."}
    </p>
  )
}
