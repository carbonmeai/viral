import { Button } from "@viral/ui/primitives/button"
import { Check, Copy } from "lucide-react"
import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { Panel } from "../panel.tsx"
import { ShortPlayer } from "../render/short-player.tsx"
import { NothingToInspect, NotYet } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { PublishInspector } from "./publish-inspector.tsx"
import { postText } from "./publish-values.ts"

// The title the short is posted with: the one you chose, else the agent's, else the short's own.
export const postTitle = (e: EditorState) => e.publish.status?.post.title ?? e.ws.metadata?.metadata.title ?? e.ws.project.title

// The Publish step's player: the published file.
export function PublishStepStage({ e }: { readonly e: EditorState }) {
  const metadata = e.ws.metadata
  if (metadata === null) return <NotYet e={e} what="post text" />
  const video = metadata.media.video ?? e.ws.render?.media.video ?? null
  return video === null
    ? <div className="grid flex-1 place-items-center text-fg-2">The published file isn't in the library.</div>
    : <ShortPlayer url={`${homeFileUrl(serverUrl, video)}?v=${metadata.version}`} onTime={e.setPlayTime} transport={e.transportLink} />
}

export const publishNote = (e: EditorState) => e.ws.metadata === null ? null : postTitle(e)

// The Post panel: the post text (title, description, hashtags, credit) with Copy all, publishing again, and the files.
export function PublishStepPanel({ e }: { readonly e: EditorState }) {
  const metadata = e.ws.metadata
  if (metadata === null) return <Panel title="Post"><NothingToInspect /></Panel>
  const copyPost = () => {
    void navigator.clipboard.writeText(postText(e.publish.status?.post ?? metadata.metadata, e.publish.status?.credit ?? metadata.metadata.credit)).then(() => {
      e.setCopied(true)
      setTimeout(() => e.setCopied(false), 1600)
    })
  }
  return (
    <Panel title="Post" action={<Button onClick={copyPost}>{e.copied ? <><Check />Copied</> : <><Copy />Copy all</>}</Button>}>
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
      />
    </Panel>
  )
}
