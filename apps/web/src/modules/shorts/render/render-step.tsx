import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { checkFrameMedia } from "../ranking/ranking-values.ts"
import { NothingToInspect, NotYet, StageBar } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { RenderInspector } from "./render-inspector.tsx"
import { ShortPlayer } from "./short-player.tsx"

// The Render step: the rendered short in its player on the stage; the check sheet and sending it back in the
// inspector.
export function RenderStepStage({ e }: { readonly e: EditorState }) {
  const render = e.ws.render
  if (render === null) return <NotYet e={e} what="render" />
  return (
    <>
      <StageBar e={e} left={`${render.render.durationS.toFixed(1)}s · ${render.render.shots} shots`} />
      {render.media.video === null
        ? <div className="grid flex-1 place-items-center text-fg-2">The render's file isn't in the library.</div>
        : <ShortPlayer url={homeFileUrl(serverUrl, render.media.video)} onTime={e.setPlayTime} />}
    </>
  )
}

export function RenderStepPanel({ e }: { readonly e: EditorState }) {
  const render = e.ws.render
  if (render === null) return <NothingToInspect />
  return (
    <RenderInspector
      render={render.render}
      checkSheetUrl={render.media.checkSheet === null ? null : homeFileUrl(serverUrl, render.media.checkSheet)}
      checkFrameUrl={render.media.video === null ? null : (file) => homeFileUrl(serverUrl, checkFrameMedia(render.media.video!, file))}
      format={e.ws.project.format}
      stages={e.stages}
      gate={e.gate}
      tab={e.renderTab}
      onTab={e.setRenderTab}
    />
  )
}
