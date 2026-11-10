import { Button } from "@viral/ui/primitives/button"
import { Film, Play } from "lucide-react"
import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { checkFrameMedia } from "../ranking/ranking-values.ts"
import { NotYet } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { RenderCheck } from "./render-inspector.tsx"
import { ShortPlayer } from "./short-player.tsx"

// The Render step's player: the rendered short, or (the toggle under it) the check sheet and what was checked.
export function RenderStepStage({ e }: { readonly e: EditorState }) {
  const render = e.ws.render
  if (render === null) return <NotYet e={e} what="render" />
  if (e.renderCheck) {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[560px] pb-2">
          <RenderCheck
            render={render.render}
            checkSheetUrl={render.media.checkSheet === null ? null : homeFileUrl(serverUrl, render.media.checkSheet)}
            checkFrameUrl={render.media.video === null ? null : (file) => homeFileUrl(serverUrl, checkFrameMedia(render.media.video!, file))}
            stages={e.stages}
          />
        </div>
      </div>
    )
  }
  return render.media.video === null
    ? <div className="grid flex-1 place-items-center text-fg-2">The render's file isn't in the library.</div>
    : <ShortPlayer url={homeFileUrl(serverUrl, render.media.video)} onTime={e.setPlayTime} transport={e.transportLink} />
}

export const renderNote = (e: EditorState) => e.ws.render === null ? null : `${e.ws.render.render.durationS.toFixed(1)}s · ${e.ws.render.render.shots} shots`

// Under the player: switch between the short and its check sheet.
export function RenderToggle({ e }: { readonly e: EditorState }) {
  if (e.ws.render === null) return null
  return (
    <Button variant="ghost" onClick={() => e.setRenderCheck(!e.renderCheck)}>
      {e.renderCheck ? <><Play />Watch the short</> : <><Film />Check sheet</>}
    </Button>
  )
}
