import { serverUrl } from "../../../config/server-url.ts"
import { artifactFileUrl } from "../../../lib/media-url.ts"
import { NothingToInspect, NotYet, StageBar } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { ThumbnailInspector } from "./thumbnail-inspector.tsx"
import { ThumbnailStage } from "./thumbnail-stage.tsx"
import { withWords, wordsOf } from "./thumbnail-values.ts"

// The Thumbnail step: the thumbnail in a phone frame on the stage; its words and moments in the inspector.
export function ThumbnailStepStage({ e }: { readonly e: EditorState }) {
  const thumbnail = e.ws.thumbnail
  if (thumbnail === null) return <NotYet e={e} what="thumbnail" />
  const config = thumbnail.thumbnail.config
  const image = thumbnail.thumbnail.image
  return (
    <>
      <StageBar e={e} left={config.lines.map((l) => l.text).join(" ")} />
      <ThumbnailStage
        url={image === null ? null : artifactFileUrl(serverUrl, e.projectOwner, "thumbnail", thumbnail.version, image)}
        layout={config.layout ?? "classic"}
      />
    </>
  )
}

export function ThumbnailStepPanel({ e }: { readonly e: EditorState }) {
  const thumbnail = e.ws.thumbnail
  if (thumbnail === null) return <NothingToInspect />
  const config = thumbnail.thumbnail.config
  const words = e.thumbWords ?? wordsOf(config)
  return (
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
        void e.gate.edit(withWords(config, words)).then((refused) => {
          e.setThumbProblems(refused)
          if (refused.length === 0) e.setThumbWords(null)
        })
      }}
      stages={e.stages}
      gate={e.gate}
      tab={e.thumbTab}
      onTab={e.setThumbTab}
    />
  )
}
