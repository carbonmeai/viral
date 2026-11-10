import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { ProjectId, RunId, ShortWorkspace } from "@viral/contracts"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { type ReactNode, useEffect, useState } from "react"
import { ServerState } from "../home/server-state.tsx"
import { TitleBar } from "../layout/title-bar.tsx"
import { emptyProgress, type RunProgress } from "../videos/run-progress.ts"
import { runProgressAtom } from "../videos/videos-api.ts"
import { CaptionsPanel } from "./captions-panel.tsx"
import { EditorFrame } from "./editor-frame.tsx"
import { EditorPlayer } from "./editor-player.tsx"
import { EditorRail } from "./editor-rail.tsx"
import { EditorSide } from "./editor-side.tsx"
import { EditorSkeleton } from "./editor-skeleton.tsx"
import { EditorTimeline } from "./editor-timeline.tsx"
import { EditorTopBar } from "./editor-top-bar.tsx"
import { type EditorStepId, type PanelId, railDot, railFor } from "./editor-values.ts"
import { LibraryPanel } from "./library-panel.tsx"
import { musicNote, MusicStepPanel, MusicStepStage } from "./music/music-step.tsx"
import { publishNote, PublishStepPanel, PublishStepStage } from "./publish/publish-step.tsx"
import { rankingNote, RankingStepPanel, RankingStepStage } from "./ranking/ranking-step.tsx"
import { renderNote, RenderStepStage, RenderToggle } from "./render/render-step.tsx"
import { scriptNote, ScriptStepPanel, ScriptStepStage } from "./script/script-step.tsx"
import { sectionsNote, SectionsStepPanel, SectionsStepStage } from "./sections/sections-step.tsx"
import { workspaceAtom } from "./shorts-api.ts"
import { ShortVideosProvider } from "./short-videos.tsx"
import { shotsNote, ShotsStepStage } from "./shots/shots-step.tsx"
import { StylePanel } from "./style-panel.tsx"
import { thumbnailNote, ThumbnailStepPanel, ThumbnailStepStage } from "./thumbnail/thumbnail-step.tsx"
import { type EditorState, useEditorState } from "./use-editor-state.ts"
import { voiceNote, VoiceStepPanel, VoiceStepStage } from "./voice/voice-step.tsx"

// The short's editor: one fixed frame for every step (the top bar, the rail and its panel, the player, the chat column
// and the timeline), filling the window.
export function ShortPage({ projectId, step, onStep }: {
  readonly projectId: ProjectId
  readonly step: EditorStepId | undefined
  readonly onStep: (step: EditorStepId) => void
}) {
  const result = useAtomValue(workspaceAtom(projectId))
  const refresh = useAtomRefresh(workspaceAtom(projectId))
  const data = AsyncResult.value(result)
  if (Option.isNone(data)) {
    // loading draws the editor itself in grey; only a failure shows the server's state
    if (!AsyncResult.isFailure(result)) return <EditorSkeleton />
    return (
      <>
        <TitleBar title="Short" />
        <div className="p-6"><ServerState result={result} onRetry={refresh}>{() => null}</ServerState></div>
      </>
    )
  }
  const ws = data.value
  return ws.run === null
    ? <Editor ws={ws} progress={emptyProgress} step={step} onStep={onStep} refresh={refresh} />
    : <LiveEditor ws={ws} runId={ws.run.id} step={step} onStep={onStep} refresh={refresh} />
}

// Follows the run live: a finished stage or a new gate reloads what the editor shows.
function LiveEditor({ ws, runId, step, onStep, refresh }: {
  readonly ws: ShortWorkspace
  readonly runId: RunId
  readonly step: EditorStepId | undefined
  readonly onStep: (step: EditorStepId) => void
  readonly refresh: () => void
}) {
  const progress = Option.getOrElse(AsyncResult.value(useAtomValue(runProgressAtom(runId))), () => emptyProgress)
  const finished = progress.stages.filter((s) => s.status !== "running" && s.status !== "waiting").length
  const gateId = progress.pending[0]?.id ?? null
  useEffect(() => {
    if (finished > 0 || gateId !== null) refresh()
  }, [finished, gateId, progress.run?.status, refresh])
  return <Editor ws={ws} progress={progress} step={step} onStep={onStep} refresh={refresh} />
}

// Each step's player content, and a few words about what it shows.
type View = (p: { readonly e: EditorState }) => ReactNode
const STAGES: Record<EditorStepId, { readonly Stage: View; readonly note: (e: EditorState) => string | null }> = {
  script: { Stage: ScriptStepStage, note: scriptNote },
  voice: { Stage: VoiceStepStage, note: voiceNote },
  shots: { Stage: ShotsStepStage, note: shotsNote },
  music: { Stage: MusicStepStage, note: musicNote },
  render: { Stage: RenderStepStage, note: renderNote },
  publish: { Stage: PublishStepStage, note: publishNote },
  thumbnail: { Stage: ThumbnailStepStage, note: thumbnailNote },
  sections: { Stage: SectionsStepStage, note: sectionsNote },
  moments: { Stage: RankingStepStage, note: rankingNote }
}

// Each panel, whichever step is open.
const PANELS: Record<PanelId, View> = {
  library: LibraryPanel,
  script: ScriptStepPanel,
  ranks: RankingStepPanel,
  sections: SectionsStepPanel,
  captions: CaptionsPanel,
  voice: VoiceStepPanel,
  music: MusicStepPanel,
  style: StylePanel,
  post: PublishStepPanel,
  thumbnail: ThumbnailStepPanel
}

function Editor(props: {
  readonly ws: ShortWorkspace
  readonly progress: RunProgress
  readonly step: EditorStepId | undefined
  readonly onStep: (step: EditorStepId) => void
  readonly refresh: () => void
}) {
  const e = useEditorState(props)
  const { ws, open, panel } = e
  // below about 1100px the chat column is an overlay the top bar opens
  const [sideOpen, setSideOpen] = useState(false)
  const ask = () => {
    setSideOpen(true)
    e.focusComposer()
  }
  const stage = STAGES[open]
  const Panel = PANELS[panel]
  return (
    <ShortVideosProvider sources={ws.videos.map((v) => v.source)}>
      <EditorFrame
        top={<EditorTopBar e={e} onSide={() => setSideOpen((o) => !o)} />}
        rail={<EditorRail items={railFor(ws.project.format)} panel={panel} dot={railDot(ws.project.format, e.waitingOn, panel)} onPanel={e.setPanel} />}
        panel={<Panel e={e} />}
        player={
          <EditorPlayer e={e} note={stage.note(e)} onAsk={ask} {...(open === "render" ? { below: <RenderToggle e={e} /> } : {})}>
            <stage.Stage e={e} />
          </EditorPlayer>
        }
        side={<EditorSide e={e} onAsk={ask} />}
        sideOpen={sideOpen}
        timeline={<EditorTimeline e={e} />}
      />
    </ShortVideosProvider>
  )
}
