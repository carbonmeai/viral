import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { ProjectId, RunId, ShortWorkspace } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowRight, Check, Copy, FolderOpen, MessageSquare, Undo2 } from "lucide-react"
import { type ReactNode, useEffect } from "react"
import { desktop } from "../../config/server-url.ts"
import { ServerState } from "../home/server-state.tsx"
import { TitleBar } from "../layout/title-bar.tsx"
import { emptyProgress, type RunProgress } from "../videos/run-progress.ts"
import { runProgressAtom } from "../videos/videos-api.ts"
import { BriefButton } from "./brief-button.tsx"
import { EditorFrame } from "./editor-frame.tsx"
import { EditorSkeleton } from "./editor-skeleton.tsx"
import { EditorTimeline } from "./editor-timeline.tsx"
import type { EditorStepId } from "./editor-values.ts"
import { LaterStep } from "./later-step.tsx"
import { MusicStepPanel, MusicStepStage } from "./music/music-step.tsx"
import { PublishStepPanel, PublishStepStage } from "./publish/publish-step.tsx"
import { postText } from "./publish/publish-values.ts"
import { RankingStepPanel, RankingStepStage } from "./ranking/ranking-step.tsx"
import { RenderStepPanel, RenderStepStage } from "./render/render-step.tsx"
import { ScriptStepPanel, ScriptStepStage } from "./script/script-step.tsx"
import { SectionsStepPanel, SectionsStepStage } from "./sections/sections-step.tsx"
import { workspaceAtom } from "./shorts-api.ts"
import { ShortVideosProvider } from "./short-videos.tsx"
import { ShotsStepPanel, ShotsStepStage } from "./shots/shots-step.tsx"
import { StepBar } from "./step-bar.tsx"
import { NothingToInspect } from "./step-parts.tsx"
import { ThumbnailStepPanel, ThumbnailStepStage } from "./thumbnail/thumbnail-step.tsx"
import { type EditorState, useEditorState } from "./use-editor-state.ts"
import { VideosMenu } from "./videos-menu.tsx"
import { VoiceStepPanel, VoiceStepStage } from "./voice/voice-step.tsx"

// The short's editor: one fixed frame (the steps, the stage, the inspector, the timeline) for every step.
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

const titleOf = (ws: ShortWorkspace) => `${String(ws.project.number).padStart(2, "0")} · ${ws.project.title}`

// Each step's view: what the stage shows and what the inspector holds.
const STEP_VIEWS: Partial<Record<EditorStepId, { readonly Stage: (p: { readonly e: EditorState }) => ReactNode; readonly Panel: (p: { readonly e: EditorState }) => ReactNode }>> = {
  script: { Stage: ScriptStepStage, Panel: ScriptStepPanel },
  voice: { Stage: VoiceStepStage, Panel: VoiceStepPanel },
  shots: { Stage: ShotsStepStage, Panel: ShotsStepPanel },
  music: { Stage: MusicStepStage, Panel: MusicStepPanel },
  render: { Stage: RenderStepStage, Panel: RenderStepPanel },
  publish: { Stage: PublishStepStage, Panel: PublishStepPanel },
  thumbnail: { Stage: ThumbnailStepStage, Panel: ThumbnailStepPanel },
  sections: { Stage: SectionsStepStage, Panel: SectionsStepPanel },
  moments: { Stage: RankingStepStage, Panel: RankingStepPanel }
}

function Editor(props: {
  readonly ws: ShortWorkspace
  readonly progress: RunProgress
  readonly step: EditorStepId | undefined
  readonly onStep: (step: EditorStepId) => void
  readonly refresh: () => void
}) {
  const e = useEditorState(props)
  const { ws, progress, steps, states, open, openStep, pending, waitingOn, current, state, working, gate, onStep, refresh } = e

  const status = pending !== null && waitingOn !== null
    ? <Status tone="wait">Waiting on {steps.find((s) => s.id === waitingOn)?.name}</Status>
    : progress.run?.status === "running" || ws.run?.status === "running"
    ? <Status tone="run">Working on {steps.find((s) => s.id === current)?.name}</Status>
    : ws.metadata !== null
    ? <Status tone="ok">Published</Status>
    : ws.run?.status === "failed"
    ? <Status tone="neutral">Stopped</Status>
    : null

  const askFor = () => {
    if (open === "voice") e.setVoiceTab("ask")
    else if (open === "shots") e.setShotsTab("ask")
    else if (open === "render") e.setRenderTab("back")
    else if (open === "thumbnail") e.setThumbTab("ask")
    else if (open === "sections") e.setSectionsTab("ask")
    else if (open === "moments") e.setRankingTab("ask")
    else e.setScriptTab("ask")
  }
  const metadata = ws.metadata
  const copyPost = () => {
    if (metadata === null) return
    void navigator.clipboard.writeText(postText(e.publish.status?.post ?? metadata.metadata, e.publish.status?.credit ?? metadata.metadata.credit)).then(() => {
      e.setCopied(true)
      setTimeout(() => e.setCopied(false), 1600)
    })
  }
  const publishActions = open === "publish" && metadata !== null ? (
    <>
      <Button size="md" onClick={copyPost}>{e.copied ? <><Check />Copied</> : <><Copy />Copy text</>}</Button>
      {desktop === undefined ? null : (
        <Button size="md" onClick={() => void desktop?.showInFinder(metadata.files.thumbnail ?? metadata.files.folder)}><FolderOpen />Show files</Button>
      )}
    </>
  ) : null

  const actions = gate.request !== null ? (
    <>
      {e.error === null ? null : <span className="text-xs text-danger">{e.error}</span>}
      <Button size="md" disabled={e.busy} onClick={askFor}>
        {open === "render" ? <><Undo2 />Send back…</> : <><MessageSquare />Ask for changes</>}
      </Button>
      <Button size="md" variant="primary" disabled={e.busy} onClick={gate.approve}><Check />Approve the {openStep.name.toLowerCase()}</Button>
    </>
  ) : publishActions !== null && state !== "done" ? publishActions : state === "done" ? (
    <>
      {publishActions}
      {open === "publish" || open === "music" ? null : <Status tone="ok">Approved</Status>}
      {current !== open && states.get(current) !== "done" ? (
        <Button size="md" variant="primary" onClick={() => onStep(current)}>Go to {steps.find((s) => s.id === current)?.name}<ArrowRight /></Button>
      ) : null}
    </>
  ) : state === "running" ? <Status tone="run">{working?.message ?? "Working…"}</Status> : null

  const view = STEP_VIEWS[open]
  return (
    <ShortVideosProvider titles={ws.videos.map((v) => v.source.title)}>
      <TitleBar title={titleOf(ws)}>
        <VideosMenu project={ws.project} running={e.going} onChanged={refresh} />
        <BriefButton project={ws.project} running={e.going} onSaved={refresh} />
        {status}
      </TitleBar>
      <EditorFrame
        bar={
          <>
            <StepBar steps={steps} states={states} open={open} onOpen={onStep} />
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </>
        }
        stage={view === undefined ? <LaterStep step={openStep} milestone="a later milestone" /> : <view.Stage e={e} />}
        inspector={view === undefined ? <NothingToInspect /> : <view.Panel e={e} />}
        timeline={<EditorTimeline e={e} />}
      />
    </ShortVideosProvider>
  )
}
