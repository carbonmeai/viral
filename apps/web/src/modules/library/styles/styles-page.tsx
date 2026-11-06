import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link, useNavigate } from "@tanstack/react-router"
import type { Preset, Project } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Copy, Pencil, Star, Trash2 } from "lucide-react"
import { useState } from "react"
import { plural } from "../../../lib/format.ts"
import { overviewAtom } from "../../home/overview.ts"
import { Page } from "../../layout/page.tsx"
import { Detail } from "../../system/detail.tsx"
import { createPreset, deletePreset, presetsAtom, setDefaultPreset } from "../library-api.ts"
import { Loaded } from "../library-loading.tsx"
import { copyName, refusal, shortsByStyle } from "../library-values.ts"
import { StyleEditor } from "./style-editor.tsx"
import { StylePreview } from "./style-preview.tsx"

const CARD_PREVIEW = 176

// Library › Styles: how your shorts look and sound. Each style as a picture of a short in it, the default
// marked, and which shorts use it. ?edit=<id> opens a style's editor in the same page.
export function StylesPage({ editing }: { readonly editing: string | undefined }) {
  const presets = useAtomValue(presetsAtom)
  const overview = useAtomValue(overviewAtom)
  const shorts = Option.getOrElse(Option.map(AsyncResult.value(overview), (o) => o.shorts), () => [])
  const projects = shorts.map((s) => s.project)
  // a real frame of footage for the previews: the first short that has one
  const frame = shorts.find((s) => s.thumb !== null)?.thumb ?? null
  const editingPreset = Option.flatMapNullishOr(AsyncResult.value(presets), (list) => list.find((p) => p.id === editing))

  if (editing !== undefined && Option.isSome(editingPreset)) {
    const all = Option.getOrElse(AsyncResult.value(presets), (): ReadonlyArray<Preset> => [])
    const usedBy = shortsByStyle(all, projects).get(editingPreset.value.id) ?? []
    return <StyleEditor preset={editingPreset.value} frame={frame} usedBy={usedBy} />
  }
  return (
    <Page title="Styles" description="How your shorts look and sound: framing, headline, captions, voice and music levels.">
      <Loaded result={presets} skeleton={<StylesSkeleton />}>
        {(list) => <StyleCards presets={list} projects={projects} frame={frame} />}
      </Loaded>
    </Page>
  )
}

function StyleCards({ presets, projects, frame }: { readonly presets: ReadonlyArray<Preset>; readonly projects: ReadonlyArray<Project>; readonly frame: string | null }) {
  const navigate = useNavigate()
  const create = useAtomSet(createPreset, { mode: "promise" })
  const byStyle = shortsByStyle(presets, projects)
  const [problem, setProblem] = useState<string | null>(null)

  const duplicate = (preset: Preset) =>
    void create({ payload: { name: copyName(preset.name, presets.map((p) => p.name)), config: preset.config }, reactivityKeys: ["presets"] })
      .then((copy) => void navigate({ to: "/library/styles", search: { edit: copy.id } }))
      .catch((e: unknown) => setProblem(refusal(e)[0] ?? null))

  return (
    <div className="grid gap-2">
      {problem === null ? null : <div className="rounded-panel bg-panel px-4 py-3 text-danger">{problem}</div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
        {presets.map((preset) => (
          <StyleCard key={preset.id} preset={preset} usedBy={byStyle.get(preset.id) ?? []} frame={frame} onDuplicate={() => duplicate(preset)} onProblem={setProblem} />
        ))}
      </div>
    </div>
  )
}

function StyleCard({ preset, usedBy, frame, onDuplicate, onProblem }: {
  readonly preset: Preset
  readonly usedBy: ReadonlyArray<Project>
  readonly frame: string | null
  readonly onDuplicate: () => void
  readonly onProblem: (problem: string | null) => void
}) {
  const makeDefault = useAtomSet(setDefaultPreset, { mode: "promise" })
  const remove = useAtomSet(deletePreset, { mode: "promise" })
  const [confirming, setConfirming] = useState(false)
  const config = preset.config

  return (
    <section className="flex flex-col gap-3 rounded-panel bg-panel p-3">
      <Link to="/library/styles" search={{ edit: preset.id }} className="self-center" aria-label={`Edit ${preset.name}`}>
        <StylePreview config={config} frame={frame} width={CARD_PREVIEW} />
      </Link>
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="m-0 truncate text-md font-semibold">{preset.name}</h2>
        {preset.isDefault ? <Status tone="ok">Default</Status> : null}
      </div>
      <div className="-mt-2 text-xs text-fg-2">
        {config.framing === "band" ? "Band" : "Full-bleed"} · {config.captions.mode === "word" ? "one word" : `${config.captions.maxWords} words`} · {config.headline === null ? "no headline" : "headline"}
        <Detail>
          <div className="mt-0.5">
            {plural(usedBy.length, "short")} · {config.loudnessLufs} LUFS · {config.voice.wordsPerSecond} words/s
          </div>
        </Detail>
      </div>
      {confirming ? (
        <div className="mt-auto flex items-center gap-2 text-xs">
          <span className="text-fg-1">Delete {preset.name}?</span>
          <Button
            className="ml-auto text-danger"
            onClick={() =>
              void remove({ payload: { id: preset.id }, reactivityKeys: ["presets"] })
                .catch((e: unknown) => onProblem(refusal(e)[0] ?? null))
                .finally(() => setConfirming(false))}
          >
            Delete
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
        </div>
      ) : (
        <div className="mt-auto flex items-center gap-1">
          <Link to="/library/styles" search={{ edit: preset.id }} className="inline-flex h-7 items-center gap-1.5 rounded-ctl bg-ctl px-2.5 text-xs font-medium hover:bg-ctl-hover [&>svg]:size-3.5">
            <Pencil />Edit
          </Link>
          <Button variant="ghost" onClick={onDuplicate}><Copy />Duplicate</Button>
          {preset.isDefault ? null : (
            <>
              <Button variant="ghost" onClick={() => void makeDefault({ payload: { id: preset.id }, reactivityKeys: ["presets"] })}><Star />Make default</Button>
              <Button variant="ghost" className="ml-auto" aria-label={`Delete ${preset.name}`} onClick={() => setConfirming(true)}><Trash2 /></Button>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function StylesSkeleton() {
  return (
    <SkeletonRegion label="Loading your styles" className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-panel bg-panel p-3">
          <Skeleton className="self-center rounded-[10px]" style={{ width: CARD_PREVIEW, height: (CARD_PREVIEW * 16) / 9 }} />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="-mt-1 h-3 w-44" />
          <div className="flex gap-1"><Skeleton className="h-7 w-16 rounded-ctl" /><Skeleton className="h-7 w-24 rounded-ctl" /></div>
        </div>
      ))}
    </SkeletonRegion>
  )
}
