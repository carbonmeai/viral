import { Segmented } from "@viral/ui/primitives/segmented"
import { ThumbnailGenerator } from "../generator/thumbnail-generator.tsx"
import { serverUrl } from "../../../config/server-url.ts"
import { artifactFileUrl } from "../../../lib/media-url.ts"
import { Panel } from "../panel.tsx"
import { NothingToInspect, NotYet } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { ThumbnailInspector } from "./thumbnail-inspector.tsx"
import { BasicNote, ThumbnailOptionsPanel, ThumbnailOptionsStage, useImageKey } from "./thumbnail-options.tsx"
import { ThumbnailStage } from "./thumbnail-stage.tsx"
import { withWords, wordsOf } from "./thumbnail-values.ts"

// The Thumbnail step's player: an AI round's options side by side, or the basic thumbnail, in phone frames.
export function ThumbnailStepStage({ e }: { readonly e: EditorState }) {
  const thumbnail = e.ws.thumbnail
  if (thumbnail === null) return <NotYet e={e} what="thumbnail" />
  const fileUrl = (file: string) => artifactFileUrl(serverUrl, e.projectOwner, "thumbnail", thumbnail.version, file)
  const generated = thumbnail.thumbnail.generated
  if (generated !== undefined) return <ThumbnailOptionsStage generated={generated} fileUrl={fileUrl} gate={e.gateFor("thumbnail")} />
  const image = thumbnail.thumbnail.image
  return <ThumbnailStage url={image === null ? null : fileUrl(image)} layout={thumbnail.thumbnail.config?.layout ?? "classic"} />
}

export const thumbnailNote = (e: EditorState) => {
  const t = e.ws.thumbnail?.thumbnail ?? null
  if (t === null) return null
  return t.generated !== undefined ? t.generated.design.words : t.config?.lines.map((l) => l.text).join(" ") ?? null
}

// The Thumbnail panel: its generator (another round with a note for an AI thumbnail; a note, another hero, the layout
// and arrow for a basic one), and its details: an AI round's options and real frames, or a basic thumbnail's words
// (edited while it waits for you), the moments it's made from and its layout.
export function ThumbnailStepPanel({ e }: { readonly e: EditorState }) {
  const thumbnail = e.ws.thumbnail
  const imageKey = useImageKey()
  const generated = thumbnail?.thumbnail.generated
  const views = (
    <Segmented<"generate" | "details">
      label="Thumbnail"
      full
      value={e.thumbView}
      onChange={e.setThumbView}
      options={[{ value: "generate", label: "Generate" }, { value: "details", label: generated !== undefined ? "Options" : "Words" }]}
    />
  )
  if (e.thumbView === "generate") return <Panel title="Thumbnail" under={views}><ThumbnailGenerator e={e} /></Panel>
  if (thumbnail === null) return <Panel title="Thumbnail" under={views}><NothingToInspect /></Panel>
  const gate = e.gateFor("thumbnail")
  if (generated !== undefined) {
    const fileUrl = (file: string) => artifactFileUrl(serverUrl, e.projectOwner, "thumbnail", thumbnail.version, file)
    return (
      <Panel title="Thumbnail" under={views}>
        <ThumbnailOptionsPanel generated={generated} fileUrl={fileUrl} gate={gate} stages={e.stages} />
      </Panel>
    )
  }
  const config = thumbnail.thumbnail.config
  if (config === null) return <Panel title="Thumbnail" under={views}><NothingToInspect /></Panel>
  const words = e.thumbWords ?? wordsOf(config)
  return (
    <Panel title="Thumbnail" under={views}>
      <div className="px-3.5 pb-2"><BasicNote imageKey={imageKey} /></div>
      <ThumbnailInspector
        config={config}
        sourceIds={e.ws.videos.map((v) => v.source.id)}
        stillUrl={e.videoStillUrl}
        words={words}
        onWords={(next) => {
          e.setThumbProblems([])
          e.setThumbWords(next)
        }}
        problems={e.thumbProblems}
        onRevert={() => {
          e.setThumbWords(null)
          e.setThumbProblems([])
        }}
        onSend={() => {
          void gate.edit(withWords(config, words)).then((refused) => {
            e.setThumbProblems(refused)
            if (refused.length === 0) e.setThumbWords(null)
          })
        }}
        stages={e.stages}
        gate={gate}
      />
    </Panel>
  )
}
