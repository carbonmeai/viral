import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { AgentProvider, SourceId } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { Switch } from "@viral/ui/primitives/switch"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ImagePlus } from "lucide-react"
import { useState } from "react"
import { serverUrl } from "../../../config/server-url.ts"
import { artifactFileUrl } from "../../../lib/media-url.ts"
import { ProviderPicker } from "../../settings/agents/agents-page.tsx"
import { ACCOUNT_OF, modelLabel, PROVIDERS, providerName } from "../../settings/agents/agents-values.ts"
import { accountsAtom, appSettingsAtom, setStageAgent } from "../../settings/settings-api.ts"
import { sendChat } from "../chat/chat-api.ts"
import { clockOf } from "../editor-values.ts"
import { framesAroundAtom, framesKey } from "../shorts-api.ts"
import { nameOf, useShortVideos } from "../short-videos.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { type PickedHero, propsOf, type ThumbProps, thumbnailPlan } from "./generator-values.ts"
import { GeneratorPreview, GeneratorShell, InputTile, ModelRow, PromptBox, PropertyRow } from "./generator-panel.tsx"

// The thumbnail step's model, chosen with the shared picker (Settings › Agents › Thumbnail, the same setting).
function ThumbnailModel() {
  const settings = Option.getOrNull(AsyncResult.value(useAtomValue(appSettingsAtom)))
  const accounts = Option.getOrElse(AsyncResult.value(useAtomValue(accountsAtom)), () => [])
  const save = useAtomSet(setStageAgent, { mode: "promise" })
  if (settings === null) return <Skeleton className="h-4 w-28" />
  const ready = Object.fromEntries(PROVIDERS.map((p) => [p, p === "claude-cli" || accounts.some((a) => a.name === ACCOUNT_OF[p] && a.status === "ready")])) as Record<AgentProvider, boolean>
  const own = settings.stageAgents.thumbnail
  const route = settings.routes.thumbnail
  const def = settings.defaultAgent
  return (
    <ProviderPicker<AgentProvider | "default">
      label="Thumbnail model"
      className="h-7 min-w-0 bg-transparent px-1.5 hover:bg-ctl"
      value={own === null ? "default" : own.provider}
      ready={ready}
      vision
      useDefault={`${providerName(def.provider)} · ${modelLabel(def.provider, def.model)}, as set in “Default for all steps”.`}
      onChange={(next) =>
        void save({ payload: { stage: "thumbnail", agent: next === "default" ? null : { provider: next, model: null } }, reactivityKeys: ["settings"] })}
      display={`${providerName(route.provider)} · ${modelLabel(route.provider, route.model)}`}
    />
  )
}

// A strip of stills around a moment of one video, one a second, to pick another hero from.
function FrameStrip({ sourceId, t, source, stillUrl, picked, onPick }: {
  readonly sourceId: SourceId
  readonly t: number
  readonly source: number
  readonly stillUrl: (path: string, source: number) => string
  readonly picked: number | null
  readonly onPick: (t: number) => void
}) {
  const frames = Option.getOrNull(AsyncResult.value(useAtomValue(framesAroundAtom(framesKey(sourceId, t, 4)))))
  if (frames === null) return <div className="grid grid-cols-3 gap-1.5">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="aspect-video" />)}</div>
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {frames.frames.map((f) => (
        <button
          key={f.t}
          type="button"
          onClick={() => onPick(f.t)}
          className={cn("relative aspect-video overflow-hidden rounded-[6px] bg-ctl-active outline-none", picked === f.t && "shadow-[0_0_0_1.5px_var(--lemon)]")}
        >
          <img src={stillUrl(f.path, source)} alt={`At ${clockOf(f.t)}`} className="size-full object-cover" loading="lazy" />
          <span className="absolute right-1 bottom-1 rounded-[4px] bg-black/60 px-1 text-[10px] text-white tabular-nums">{clockOf(f.t)}</span>
        </button>
      ))}
    </div>
  )
}

// The still at one moment of a video, for an input tile.
function useStill(sourceId: SourceId | undefined, t: number, source: number, stillUrl: (path: string, source: number) => string) {
  const frames = Option.getOrNull(AsyncResult.value(useAtomValue(framesAroundAtom(framesKey(sourceId ?? ("" as SourceId), t, 0)))))
  const frame = frames?.frames[0] ?? null
  return frame === null ? null : stillUrl(frame.path, source)
}

// The Thumbnail panel's generator (no new API): the thumbnail agent's model, a prompt that becomes its note, the hero
// and face moments plus "Another frame", and the layout and arrow. Properties alone, at the gate, redraw it with no agent
// (CheckThumbnailEdit + Edit); anything else goes to the thumbnail agent as a note through the chat, which asks for
// changes at the gate or redoes the approved step with it.
export function ThumbnailGenerator({ e }: { readonly e: EditorState }) {
  const names = useShortVideos()
  const send = useAtomSet(sendChat, { mode: "promise" })
  const thumbnail = e.ws.thumbnail
  const config = thumbnail?.thumbnail.config ?? null
  const [prompt, setPrompt] = useState("")
  const [props, setProps] = useState<ThumbProps | null>(null)
  const [hero, setHero] = useState<PickedHero | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const ids = e.ws.videos.map((v) => v.source.id)
  const heroSource = config?.hero.source ?? 0
  const heroStill = useStill(ids[heroSource], config?.hero.src ?? 0, heroSource, e.videoStillUrl)
  const faceSource = config?.inset?.source ?? 0
  const faceStill = useStill(ids[faceSource], config?.inset?.src ?? 0, faceSource, e.videoStillUrl)
  const gate = e.gateFor("thumbnail")

  if (config === null || thumbnail === null) {
    return (
      <GeneratorShell
        preview={<GeneratorPreview state="empty" />}
        model={<ModelRow picker={<ThumbnailModel />} />}
        prompt={<PromptBox value={prompt} onChange={setPrompt} placeholder="Bigger face, angrier, more red" />}
        cost="Opens when the run gets to the thumbnail"
        generate={{ disabled: true, busy: false, onClick: () => undefined }}
      />
    )
  }
  const current = props ?? propsOf(config)
  const plan = thumbnailPlan({ config, prompt, props: current, hero, atGate: gate.request !== null })
  const image = thumbnail.thumbnail.image
  const url = image === null ? null : artifactFileUrl(serverUrl, e.projectOwner, "thumbnail", thumbnail.version, image)

  const generate = () => {
    setProblem(null)
    setSent(null)
    if (plan._tag === "Nothing") return
    if (plan._tag === "Redraw") {
      setBusy(true)
      void gate.edit(plan.config).then((refused) => {
        if (refused.length > 0) setProblem(refused.join(" "))
        else {
          setSent("Redrawn with your properties. No agent, no cost.")
          setProps(null)
        }
      }).finally(() => setBusy(false))
      return
    }
    setBusy(true)
    void send({ payload: { projectId: e.ws.project.id, step: "thumbnail", text: plan.note } })
      .then((result) => {
        const item = result.said.item
        setSent(item._tag === "YouSaid" && item.action._tag === "NotDone" ? item.action.reason : "Sent to the thumbnail agent. Follow it in the chat.")
        setPrompt("")
        setHero(null)
        setProps(null)
        setChoosing(false)
      })
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : "Couldn’t send it to the thumbnail agent."))
      .finally(() => setBusy(false))
  }

  return (
    <GeneratorShell
      preview={
        <GeneratorPreview state={busy ? "working" : url === null ? "empty" : "done"}>
          {url === null ? null : <img src={url} alt="The thumbnail" className="mx-auto aspect-[9/16] h-[260px] rounded-[8px] object-cover" />}
          {sent === null ? null : <span className="px-1 pt-1 text-xs text-fg-1">{sent}</span>}
        </GeneratorPreview>
      }
      model={<ModelRow picker={<ThumbnailModel />} />}
      prompt={<PromptBox value={prompt} onChange={setPrompt} placeholder="Bigger face, angrier, more red" />}
      inputs={
        <>
          <div className="flex flex-wrap gap-2">
            <InputTile picture={heroStill} value={hero === null ? `${nameOf(names, heroSource)} ${clockOf(config.hero.src)}` : `${hero.name} ${clockOf(hero.t)}`} label="Hero" on={hero !== null} />
            {config.inset === undefined ? null : <InputTile picture={faceStill} value={`${nameOf(names, faceSource)} ${clockOf(config.inset.src)}`} label="Face" />}
            <InputTile icon={<ImagePlus />} label="Another frame" on={choosing} onClick={() => setChoosing((v) => !v)} />
          </div>
          {choosing && ids[heroSource] !== undefined ? (
            <FrameStrip
              sourceId={ids[heroSource]!}
              t={config.hero.src}
              source={heroSource}
              stillUrl={e.videoStillUrl}
              picked={hero?.t ?? null}
              onPick={(t) => setHero(hero?.t === t ? null : { source: heroSource, t, name: nameOf(names, heroSource) })}
            />
          ) : null}
        </>
      }
      properties={
        <>
          <PropertyRow label="Layout">
            <Segmented<"bold" | "classic"> label="Layout" value={current.layout} onChange={(layout) => setProps({ ...current, layout })} options={[{ value: "bold", label: "Bold" }, { value: "classic", label: "Classic" }]} />
          </PropertyRow>
          <PropertyRow label="Arrow"><Switch label="Arrow" checked={current.arrow} onChange={(arrow) => setProps({ ...current, arrow })} /></PropertyRow>
        </>
      }
      cost={plan._tag === "Redraw" ? "Redraw only: no agent, no cost" : plan._tag === "Note" ? `The thumbnail agent · ${gate.request !== null ? "asks for changes" : "redoes the thumbnail"}` : plan.why}
      problem={problem ?? gate.error}
      generate={{ label: plan._tag === "Redraw" ? "Redraw" : "Generate", disabled: plan._tag === "Nothing", busy: busy || gate.busy, onClick: generate }}
    />
  )
}
