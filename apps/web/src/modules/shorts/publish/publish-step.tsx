import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { ShortPlayer } from "../render/short-player.tsx"
import { NothingToInspect, NotYet, StageBar } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { PublishInspector } from "./publish-inspector.tsx"

// The title the short is posted with: the one you chose, else the agent's, else the short's own.
export const postTitle = (e: EditorState) => e.publish.status?.post.title ?? e.ws.metadata?.metadata.title ?? e.ws.project.title

// The Publish step: the published file in its player on the stage; the post text and files in the inspector.
export function PublishStepStage({ e }: { readonly e: EditorState }) {
  const metadata = e.ws.metadata
  if (metadata === null) return <NotYet e={e} what="post text" />
  const video = metadata.media.video ?? e.ws.render?.media.video ?? null
  return (
    <>
      <StageBar e={e} left={postTitle(e)} />
      {video === null
        ? <div className="grid flex-1 place-items-center text-fg-2">The published file isn't in the library.</div>
        : <ShortPlayer url={`${homeFileUrl(serverUrl, video)}?v=${metadata.version}`} onTime={e.setPlayTime} />}
    </>
  )
}

export function PublishStepPanel({ e }: { readonly e: EditorState }) {
  const metadata = e.ws.metadata
  if (metadata === null) return <NothingToInspect />
  return (
    <PublishInspector
      metadata={metadata.metadata}
      slug={e.ws.project.slug}
      sources={e.ws.videos.map((v) => v.source)}
      files={{
        video: metadata.media.video === null ? null : homeFileUrl(serverUrl, metadata.media.video),
        captions: metadata.media.captions === null ? null : homeFileUrl(serverUrl, metadata.media.captions),
        notes: metadata.media.notes === null ? null : homeFileUrl(serverUrl, metadata.media.notes),
        thumbnail: metadata.media.thumbnail === null ? null : homeFileUrl(serverUrl, metadata.media.thumbnail),
        folder: metadata.files.folder
      }}
      publish={e.publish}
      stages={e.stages}
      tab={e.publishTab}
      onTab={e.setPublishTab}
    />
  )
}
