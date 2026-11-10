import { serverUrl } from "../../../config/server-url.ts"
import { artifactFileUrl } from "../../../lib/media-url.ts"
import { Panel } from "../panel.tsx"
import { NothingToInspect, NotYet } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { ThumbnailInspector } from "./thumbnail-inspector.tsx"
import { ThumbnailStage } from "./thumbnail-stage.tsx"
import { withWords, wordsOf } from "./thumbnail-values.ts"

// The Thumbnail step's player: the thumbnail in a phone frame.
export function ThumbnailStepStage({ e }: { readonly e: EditorState }) {
  const thumbnail = e.ws.thumbnail
  if (thumbnail === null) return <NotYet e={e} what="thumbnail" />
  const config = thumbnail.thumbnail.config
  const image = thumbnail.thumbnail.image
  return (
    <ThumbnailStage
      url={image === null ? null : artifactFileUrl(serverUrl, e.projectOwner, "thumbnail", thumbnail.version, image)}
      layout={config.layout ?? "classic"}
    />
  )
}

export const thumbnailNote = (e: EditorState) => e.ws.thumbnail === null ? null : e.ws.thumbnail.thumbnail.config.lines.map((l) => l.text).join(" ")

// The Thumbnail panel: its words (edited while it waits for you), the moments it's made from and its layout.
export function ThumbnailStepPanel({ e }: { readonly e: EditorState }) {
  const thumbnail = e.ws.thumbnail
  if (thumbnail === null) return <Panel title="Thumbnail"><NothingToInspect /></Panel>
  const config = thumbnail.thumbnail.config
  const words = e.thumbWords ?? wordsOf(config)
  const gate = e.gateFor("thumbnail")
  return (
    <Panel title="Thumbnail">
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
