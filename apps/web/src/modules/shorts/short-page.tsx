import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { GateResponse, ProjectId, RunId, RunRequest, ShortWorkspace, StageRun, Voice } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowRight, Check, MessageSquare } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { serverUrl } from "../../config/server-url.ts"
import { artifactPathUrl } from "../../lib/media-url.ts"
import { ServerState } from "../home/server-state.tsx"
import { TitleBar } from "../layout/title-bar.tsx"
import { voicesAtom } from "../settings/settings-api.ts"
import { Detail } from "../system/detail.tsx"
import { emptyProgress, type RunProgress } from "../videos/run-progress.ts"
import { runProgressAtom } from "../videos/videos-api.ts"
import { EditorFrame } from "./editor-frame.tsx"
import {
  type EditorStepId,
  editorSteps,
  layoutTimeline,
  openingStep,
  shortTimeOf,
  stepOfRequest,
  stepStates
} from "./editor-values.ts"
import type { GateControls } from "./gate.ts"
import { LaterStep } from "./later-step.tsx"
import { ScriptInspector, type ScriptTab } from "./script/script-inspector.tsx"
import { ScriptStage } from "./script/script-stage.tsx"
import { checkScriptEdit, respondToRequest, setProjectVoice, workspaceAtom } from "./shorts-api.ts"
import { StepBar } from "./step-bar.tsx"
import { Timeline } from "./timeline.tsx"
import { VoiceInspector, type VoiceTab } from "./voice/voice-inspector.tsx"
import { VoiceStage } from "./voice/voice-stage.tsx"

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

function Editor({ ws, progress, step, onStep, refresh }: {
  readonly ws: ShortWorkspace
  readonly progress: RunProgress
  readonly step: EditorStepId | undefined
  readonly onStep: (step: EditorStepId) => void
  readonly refresh: () => void
}) {
  // the live run is fresher than the last workspace load
  const stages: ReadonlyArray<StageRun> = progress.run === null ? ws.stages : progress.stages
  const pending: RunRequest | null = progress.run === null ? ws.pending : progress.pending[0] ?? null
  const steps = editorSteps(ws.project.format)
  const states = useMemo(() => stepStates(steps, stages), [steps, stages])
  const open = step !== undefined && steps.some((s) => s.id === step) ? step : openingStep(steps, states)
  const openStep = steps.find((s) => s.id === open)!
  const waitingOn = stepOfRequest(steps, pending)
  const current = openingStep(steps, states)

  const respond = useAtomSet(respondToRequest, { mode: "promise" })
  const check = useAtomSet(checkScriptEdit, { mode: "promise" })
  const setVoice = useAtomSet(setProjectVoice, { mode: "promise" })
  const voices = Option.getOrElse(AsyncResult.value(useAtomValue(voicesAtom)), (): ReadonlyArray<Voice> => [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scriptTab, setScriptTab] = useState<ScriptTab>("rules")
  const [voiceTab, setVoiceTab] = useState<VoiceTab>("voice")
  const [beat, setBeat] = useState<number | null>(null)
  const [voTime, setVoTime] = useState<number | null>(null)

  const request = waitingOn === open ? pending : null
  const answer = (response: GateResponse) => {
    if (request === null) return Promise.resolve()
    setBusy(true)
    setError(null)
    return respond({ payload: { requestId: request.id, response } })
      .then(() => refresh())
      .catch(() => setError("Couldn't send that. Is the server running?"))
      .finally(() => setBusy(false))
  }
  const gate: GateControls = {
    request,
    busy,
    error,
    approve: () => void answer({ _tag: "Approve" }),
    ask: (note) => void answer({ _tag: "Reject", note }),
    edit: (artifact) => {
      if (request === null) return Promise.resolve(["This step isn't waiting for you."])
      // a script edit is checked first, so a problem is shown instead of failing the run
      const checked = open === "script" && ws.script !== null
        ? check({ payload: { projectId: ws.project.id, script: artifact as typeof ws.script.script } }).then((r) => r.problems)
        : Promise.resolve([] as ReadonlyArray<string>)
      return checked.then((problems) => problems.length > 0 ? problems : answer({ _tag: "Edit", artifact }).then(() => []))
    }
  }

  const onTime = useCallback((t: number | null) => setVoTime(t), [])
  const projectOwner = { _tag: "Project", id: ws.project.id } as const
  const voiceUrl = ws.voiceover?.path === null || ws.voiceover === null ? null : artifactPathUrl(serverUrl, projectOwner, ws.voiceover.path)
  const sourceVideoUrl = ws.sourceVideo === null ? null : artifactPathUrl(serverUrl, { _tag: "Source", id: ws.source.id }, ws.sourceVideo)
  const layout = ws.script !== null && ws.voiceover !== null && ws.voiceover.words.length > 0
    ? layoutTimeline(ws.script.script, ws.voiceover.words, ws.voiceover.voiceover.durationS)
    : null
  const voiceName = voices.find((v) => v.voiceId === ws.voiceId)?.name.split(" - ")[0] ?? "Voice"
  const working = openStep.stages.map((s) => progress.live[s]).find((l) => l !== undefined) ?? null
  const state = states.get(open) ?? "next"

  const newVoice = (voice: Voice) => {
    setBusy(true)
    setVoice({ payload: { id: ws.project.id, voiceId: voice.voiceId } })
      .then(() => answer({ _tag: "Reject", note: `Make a new take with the voice ${voice.name.split(" - ")[0]}.` }))
      .catch(() => setError("Couldn't change the voice."))
      .finally(() => setBusy(false))
  }

  const status = pending !== null && waitingOn !== null
    ? <Status tone="wait">Waiting on {steps.find((s) => s.id === waitingOn)?.name}</Status>
    : progress.run?.status === "running" || ws.run?.status === "running"
    ? <Status tone="run">Working on {steps.find((s) => s.id === current)?.name}</Status>
    : ws.metadata !== null
    ? <Status tone="ok">Published</Status>
    : ws.run?.status === "failed"
    ? <Status tone="neutral">Stopped</Status>
    : null

  const actions = request !== null ? (
    <>
      {error === null ? null : <span className="text-xs text-danger">{error}</span>}
      <Button
        size="md"
        disabled={busy}
        onClick={() => (open === "voice" ? setVoiceTab("ask") : setScriptTab("ask"))}
      >
        <MessageSquare />Ask for changes
      </Button>
      <Button size="md" variant="primary" disabled={busy} onClick={gate.approve}><Check />Approve the {openStep.name.toLowerCase()}</Button>
    </>
  ) : state === "done" ? (
    <>
      <Status tone="ok">Approved</Status>
      {current !== open && states.get(current) !== "done" ? (
        <Button size="md" variant="primary" onClick={() => onStep(current)}>Go to {steps.find((s) => s.id === current)?.name}<ArrowRight /></Button>
      ) : null}
    </>
  ) : state === "running" ? <Status tone="run">{working?.message ?? "Working…"}</Status> : null

  const stageBar = (left: string) => (
    <div className="flex shrink-0 items-center gap-2 px-3.5 py-2.5">
      <span className="text-xs text-fg-2">{left}</span>
      <span className="ml-auto inline-flex h-[22px] items-center rounded-chip bg-ctl px-2 text-xs text-fg-1">{ws.preset.name}</span>
      <Detail><span className="inline-flex h-[22px] items-center rounded-chip bg-ctl px-2 text-xs text-fg-1">{ws.project.approach}</span></Detail>
    </div>
  )

  const notYet = (what: string) => (
    <div className="grid flex-1 place-items-center px-6 text-center text-fg-2">
      {state === "running" ? (working?.message ?? `Making the ${what}…`) : `The ${what} is made when the run gets here.`}
    </div>
  )

  let stage, inspector
  if (open === "script") {
    stage = ws.script === null ? notYet("script") : (
      <>
        {stageBar(`${ws.script.script.beats.length} lines`)}
        <div className="min-h-0 flex-1 overflow-auto">
          <ScriptStage script={ws.script.script} preset={ws.preset} sourceVideoUrl={sourceVideoUrl} gate={gate} selected={beat} onSelect={setBeat} />
        </div>
      </>
    )
    inspector = ws.script === null ? null : (
      <ScriptInspector script={ws.script.script} limits={ws.scriptLimits} preset={ws.preset} stages={stages} gate={gate} tab={scriptTab} onTab={setScriptTab} />
    )
  } else if (open === "voice") {
    stage = ws.voiceover === null ? notYet("voiceover") : (
      <>
        {stageBar(`${ws.voiceover.words.length} words spoken`)}
        <div className="min-h-0 flex-1 overflow-auto">
          <VoiceStage
            voiceover={ws.voiceover.voiceover}
            words={ws.voiceover.words}
            url={voiceUrl}
            voiceName={voiceName}
            pauses={layout?.pauses.map((p) => p.at) ?? []}
            onTime={onTime}
          />
        </div>
      </>
    )
    inspector = ws.voiceover === null ? null : (
      <VoiceInspector voiceover={ws.voiceover.voiceover} voiceId={ws.voiceId} stages={stages} gate={gate} onNewVoice={newVoice} tab={voiceTab} onTab={setVoiceTab} />
    )
  } else {
    stage = <LaterStep step={openStep} milestone={open === "render" || open === "publish" ? "M5" : "M4"} />
    inspector = null
  }

  const captions = ws.preset.config.captions
  return (
    <>
      <TitleBar title={titleOf(ws)}>{status}</TitleBar>
      <EditorFrame
        bar={
          <>
            <StepBar steps={steps} states={states} open={open} onOpen={onStep} />
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </>
        }
        stage={stage}
        inspector={inspector ?? <div className="p-4 text-xs text-fg-2">Nothing to inspect here yet.</div>}
        timeline={
          <Timeline
            layout={layout}
            head={open === "voice" && voTime !== null && layout !== null ? shortTimeOf(layout, voTime) : null}
            captions={`${captions.enabled ? `${captions.mode === "chunk" ? `${captions.maxWords} words at a time` : "One word at a time"} · ${captions.case}` : "No captions (finish in an editor from the .srt)"}`}
            music={ws.project.musicTrackId === null ? "No music · voice only" : "Music · its drop lands on the last narrated line"}
            shots={ws.shotPlan !== null ? `${ws.shotPlan.plan.shots.length} shots · opens in step 3` : "Shots are planned in step 3"}
          />
        }
      />
    </>
  )
}
