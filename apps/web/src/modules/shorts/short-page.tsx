import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { GateResponse, MusicTrack, MusicTrackId, ProjectId, RunId, RunRequest, SectionsProposal, ShortWorkspace, ShotProposal, StageRun, ThumbConfig, Voice } from "@viral/contracts"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Button } from "@viral/ui/primitives/button"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowRight, Check, Copy, Eye, FolderOpen, LayoutGrid, MessageSquare, Undo2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { desktop, serverUrl } from "../../config/server-url.ts"
import { artifactFileUrl, artifactPathUrl, homeFileUrl } from "../../lib/media-url.ts"
import { ServerState } from "../home/server-state.tsx"
import { TitleBar } from "../layout/title-bar.tsx"
import { tracksAtom, voicesAtom } from "../library/library-api.ts"
import { Detail, useDetailed } from "../system/detail.tsx"
import { emptyProgress, type RunProgress } from "../videos/run-progress.ts"
import { runProgressAtom } from "../videos/videos-api.ts"
import { BriefButton } from "./brief-button.tsx"
import { MultiVideoNote } from "./multi-video-note.tsx"
import { videoNames } from "../sets/set-values.ts"
import { ShortVideosProvider } from "./short-videos.tsx"
import { EditorFrame } from "./editor-frame.tsx"
import { EditorSkeleton } from "./editor-skeleton.tsx"
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
import { MusicInspector, type MusicTab } from "./music/music-inspector.tsx"
import { MusicStage } from "./music/music-stage.tsx"
import { ArrangeInspector, ArrangeUnavailable } from "./music/music-arrange.tsx"
import {
  bedBlocks,
  blockLabel,
  defaultDropWord,
  gridOf,
  loopTicks,
  type PlaceContext,
  type PlacedBlock,
  placeBlocks,
  placedFrom,
  withBlock
} from "./music/music-values.ts"
import { useArrangeDraft } from "./music/use-arrange-draft.ts"
import { PublishInspector, type PublishTab } from "./publish/publish-inspector.tsx"
import { postText } from "./publish/publish-values.ts"
import { usePublish } from "./publish/use-publish.ts"
import { RenderInspector, type RenderTab } from "./render/render-inspector.tsx"
import { ShortPlayer } from "./render/short-player.tsx"
import { ScriptInspector, type ScriptTab } from "./script/script-inspector.tsx"
import { ScriptStage } from "./script/script-stage.tsx"
import {
  cancelRun,
  checkScriptEdit,
  checkSectionsEdit,
  checkShotsEdit,
  checkThumbnailEdit,
  musicBedAtom,
  refitMusic,
  respondToRequest,
  setProjectVoice,
  stillAt,
  workspaceAtom
} from "./shorts-api.ts"
import { CutTimeline } from "./sections/cut-timeline.tsx"
import { SectionsInspector, type SectionsTab } from "./sections/sections-inspector.tsx"
import { SectionsStage, type SectionsView } from "./sections/sections-stage.tsx"
import { changeCount, draftOf, proposalOf as sectionsProposal, sectionBlocks, type SectionsDraft } from "./sections/sections-values.ts"
import type { PickedFrame, PickerVideo } from "./shots/frame-picker.tsx"
import { ShotsInspector, type ShotsTab } from "./shots/shots-inspector.tsx"
import { ShotsStage, type ShotsView } from "./shots/shots-stage.tsx"
import { proposalOf, type ShotChange, shotSpans, timelineShots } from "./shots/shots-values.ts"
import { StepBar } from "./step-bar.tsx"
import { ThumbnailInspector, type ThumbnailTab } from "./thumbnail/thumbnail-inspector.tsx"
import { ThumbnailStage } from "./thumbnail/thumbnail-stage.tsx"
import { type ThumbnailWords, withWords, wordsOf } from "./thumbnail/thumbnail-values.ts"
import { Timeline, type TimelineMark, type TimelineMusicParts } from "./timeline.tsx"
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
  const checkShots = useAtomSet(checkShotsEdit, { mode: "promise" })
  const checkThumbnail = useAtomSet(checkThumbnailEdit, { mode: "promise" })
  const setVoice = useAtomSet(setProjectVoice, { mode: "promise" })
  const voices = Option.getOrElse(AsyncResult.value(useAtomValue(voicesAtom)), (): ReadonlyArray<Voice> => [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scriptTab, setScriptTab] = useState<ScriptTab>("rules")
  const [voiceTab, setVoiceTab] = useState<VoiceTab>("voice")
  const [beat, setBeat] = useState<number | null>(null)
  const [voTime, setVoTime] = useState<number | null>(null)
  // the Shots step: the selected shot, the stage's view, the frame picker, and your edit in progress
  const [shotK, setShotK] = useState(0)
  const [shotsView, setShotsView] = useState<ShotsView>("preview")
  const [shotsTab, setShotsTab] = useState<ShotsTab>("shot")
  const [picking, setPicking] = useState(false)
  const [candidate, setCandidate] = useState<PickedFrame | null>(null)
  const [draft, setDraft] = useState<ReadonlyMap<number, ShotChange>>(new Map())
  const [shotProblems, setShotProblems] = useState<ReadonlyArray<string>>([])
  // Render, Publish and Thumbnail: the inspector's tab, where the player is, and the thumbnail's words as you edit
  // them
  const [renderTab, setRenderTab] = useState<RenderTab>("check")
  const [publishTab, setPublishTab] = useState<PublishTab>("post")
  const [thumbTab, setThumbTab] = useState<ThumbnailTab>("thumbnail")
  const [playTime, setPlayTime] = useState<number | null>(null)
  const [thumbWords, setThumbWords] = useState<ThumbnailWords | null>(null)
  const [thumbProblems, setThumbProblems] = useState<ReadonlyArray<string>>([])
  const [copied, setCopied] = useState(false)
  // the Sections step (cut-down shorts): the selected section, the stage's view, your edit in progress, and the
  // stills fetched for sections whose start you moved (by source second)
  const [sectionK, setSectionK] = useState(0)
  const [sectionsView, setSectionsView] = useState<SectionsView>("preview")
  const [sectionsTab, setSectionsTab] = useState<SectionsTab>("section")
  const [sectionsDraft, setSectionsDraft] = useState<SectionsDraft | null>(null)
  const [sectionProblems, setSectionProblems] = useState<ReadonlyArray<string>>([])
  const [sectionPlaying, setSectionPlaying] = useState(false)
  const [stills, setStills] = useState<ReadonlyMap<number, string>>(new Map())
  const checkSections = useAtomSet(checkSectionsEdit, { mode: "promise" })
  const fetchStill = useAtomSet(stillAt, { mode: "promise" })
  // the Music step: the short's fitted bed, the library's songs, the inspector's tab, the song picker, and where
  // the bed is playing
  const bedResult = useAtomValue(musicBedAtom(ws.project.id))
  const refreshBed = useAtomRefresh(musicBedAtom(ws.project.id))
  const fitted = Option.getOrNull(AsyncResult.value(bedResult))
  const tracks = Option.getOrElse(AsyncResult.value(useAtomValue(tracksAtom)), (): ReadonlyArray<MusicTrack> => [])
  const [musicTab, setMusicTab] = useState<MusicTab>("song")
  const [pickingSong, setPickingSong] = useState(false)
  const [bedTime, setBedTime] = useState<number | null>(null)
  const refit = useAtomSet(refitMusic, { mode: "promise" })
  const cancel = useAtomSet(cancelRun, { mode: "promise" })
  // a new bed is fitted whenever assemble finishes
  const assembled = stages.filter((s) => s.stage === "assemble").map((s) => `${s.id}:${s.status}`).join(",")
  useEffect(() => refreshBed(), [assembled, refreshBed])

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
    sendBack: (note, to) => void answer({ _tag: "Reject", note, to }),
    edit: (artifact) => {
      if (request === null) return Promise.resolve(["This step isn't waiting for you."])
      // a script or shots edit is checked first, so a problem is shown instead of failing the run
      const checked = open === "script" && ws.script !== null
        ? check({ payload: { projectId: ws.project.id, script: artifact as typeof ws.script.script } }).then((r) => r.problems)
        : open === "shots"
        ? checkShots({ payload: { projectId: ws.project.id, proposal: artifact as ShotProposal } }).then((r) => r.problems)
        : open === "sections"
        ? checkSections({ payload: { projectId: ws.project.id, proposal: artifact as SectionsProposal } }).then((r) => r.problems)
        : open === "thumbnail"
        ? checkThumbnail({ payload: { projectId: ws.project.id, config: artifact as ThumbConfig } }).then((r) => r.problems)
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
  // a shot's image: the still you picked for it, else its planned frame next to the shot plan
  const sourceOwner = { _tag: "Source", id: ws.source.id } as const
  const stillUrl = (path: string) => artifactPathUrl(serverUrl, sourceOwner, path)
  // the short's videos (the first one first): each one's file, and a still of it, by position
  const videoOf = (source: number) => ws.videos[source] ?? ws.videos[0]
  const videoUrlOf = (source: number) => {
    const v = videoOf(source)
    return v === undefined || v.video === null ? null : artifactPathUrl(serverUrl, { _tag: "Source", id: v.source.id }, v.video)
  }
  const videoStillUrl = (path: string, source: number) => artifactPathUrl(serverUrl, { _tag: "Source", id: videoOf(source)?.source.id ?? ws.source.id }, path)
  const pickerVideos: ReadonlyArray<PickerVideo> = ws.videos.map((v) => ({ sourceId: v.source.id, title: v.source.title ?? "Untitled video", seconds: v.seconds }))
  const shotFrame = (k: number) => {
    const change = draft.get(k)
    if (change?.still !== undefined) return videoStillUrl(change.still, change.source ?? ws.shotPlan?.plan.shots[k]?.source ?? 0)
    const frame = ws.shotPlan?.plan.shots[k]?.frame ?? null
    return frame === null || ws.shotPlan === null ? null : artifactFileUrl(serverUrl, projectOwner, "shot-plan", ws.shotPlan.version, frame)
  }
  const realFrame = (kind: "insert" | "outro", index: number) => {
    const clip = kind === "insert" ? ws.shotPlan?.plan.inserts[index] : ws.shotPlan?.plan.outro[index]
    return clip?.frame === null || clip === undefined || ws.shotPlan === null ? null : artifactFileUrl(serverUrl, projectOwner, "shot-plan", ws.shotPlan.version, clip.frame)
  }
  const shotBlocks = ws.shotPlan !== null && layout !== null && ws.voiceover !== null
    ? timelineShots(shotSpans(ws.shotPlan.plan, ws.voiceover.words, ws.voiceover.voiceover.durationS), layout)
    : null
  // a cut-down short's sections: your edit in progress, else the plan's
  const planDraft = useMemo(() => (ws.cutPlan === null ? null : draftOf(ws.cutPlan.plan)), [ws.cutPlan])
  const sections = sectionsDraft ?? planDraft
  // the timeline shows your edit only on the Sections step; the other steps show what was rendered
  const timelineSections = open === "sections" ? sections : planDraft
  const stillOf = (draft: SectionsDraft | null) => (k: number) => {
    const section = draft?.sections[k]
    if (section === undefined || ws.cutPlan === null) return null
    if (section.frame !== null) return artifactFileUrl(serverUrl, projectOwner, "cut-plan", ws.cutPlan.version, section.frame)
    const still = stills.get(Math.round(section.start))
    return still === undefined ? null : stillUrl(still)
  }
  const sectionStill = stillOf(sections)
  // a section whose start moved, or that you added, gets a still of the video at its new start
  const missing = sections?.sections.filter((s) => s.frame === null && !stills.has(Math.round(s.start))).map((s) => Math.round(s.start)) ?? []
  const missingKey = missing.join(",")
  useEffect(() => {
    for (const t of missing) {
      void fetchStill({ payload: { sourceId: ws.source.id, t, span: 0, every: 1 } })
        .then((r) => {
          const frame = r.frames[0]
          if (frame !== undefined) setStills((m) => new Map(m).set(t, frame.path))
        })
        .catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the set of missing starts changes
  }, [missingKey])
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

  const liveRun = progress.run ?? ws.run
  const runGoing = liveRun !== null && (liveRun.status === "running" || liveRun.status === "waiting")
  // changes the song (null: no music) and/or the drop word, stopping a run that's going, then follows the re-run
  const applyMusic = (trackId: MusicTrackId | null, dropWord: number | null | undefined) => {
    setBusy(true)
    setError(null)
    const stop = runGoing && liveRun !== null ? cancel({ payload: { runId: liveRun.id } }) : Promise.resolve(true)
    return stop
      .then(() => refit({
        payload: { projectId: ws.project.id, trackId, ...(dropWord === undefined ? {} : { dropWord }) },
        reactivityKeys: [`short:${ws.project.id}`]
      }))
      .then(() => {
        setPickingSong(false)
        refresh()
      })
      .catch(() => setError("Couldn't change the music. Is the server running?"))
      .finally(() => setBusy(false))
  }

  // the Music step's arrangement: your draft over the fitted bed, its preview, and the word picker for a pinned part
  const detailed = useDetailed()
  const [pickingWord, setPickingWord] = useState(false)
  const arrange = useArrangeDraft({
    projectId: ws.project.id,
    bed: fitted?.bed ?? null,
    stopRun: () => (runGoing && liveRun !== null ? cancel({ payload: { runId: liveRun.id } }) : Promise.resolve(true)),
    onApplied: () => {
      setPickingWord(false)
      refresh()
    }
  })
  const voWords = ws.voiceover?.words ?? []
  const musicPlace: PlaceContext | null = fitted === null || layout === null ? null : {
    barS: fitted.bed.barS,
    dropWord: fitted.bed.dropWord,
    wordAt: (i) => {
      const w = voWords[i]
      return w === undefined ? null : shortTimeOf(layout, w.s)
    },
    total: fitted.bed.durationS
  }
  // the song's bar grid: from the fitted bed, or (a bed fitted before arrangements) from the last preview
  const musicGrid = (fitted === null ? null : gridOf(fitted.bed)) ?? (arrange.lastPreview === null ? null : gridOf(arrange.lastPreview))
  const appliedPlaced: ReadonlyArray<PlacedBlock | null> = musicPlace === null || fitted?.bed.arrangement === undefined ? [] : placedFrom(fitted.bed.arrangement.blocks, musicPlace)
  const draftPlaced: ReadonlyArray<PlacedBlock | null> = musicPlace === null || arrange.draft === null ? appliedPlaced
    : arrange.heard?.bed.arrangement !== undefined ? placedFrom(arrange.heard.bed.arrangement.blocks, musicPlace)
    : placeBlocks(arrange.draft.blocks, musicPlace)
  // the timeline shows your draft only on the Music step; the other steps show what was rendered
  const laneBlocks = open === "music" ? arrange.blocks : fitted?.bed.arrangement?.blocks ?? null
  const lanePlaced = open === "music" ? draftPlaced : appliedPlaced
  const musicParts: TimelineMusicParts | null = ws.project.musicTrackId === null || laneBlocks === null || musicGrid === null || musicPlace === null ? null : {
    parts: laneBlocks.flatMap((b, i) => {
      const p = lanePlaced[i]
      return p === null || p === undefined ? [] : [{ index: i, start: p.atS, end: p.endS, label: blockLabel(b, musicGrid.dropBar), ticks: loopTicks(p, b, musicPlace.barS) }]
    }),
    selected: open === "music" && musicTab === "arrange" && detailed ? arrange.selected : null,
    onSelect: (i) => {
      arrange.select(i)
      setPickingWord(false)
      if (detailed) setMusicTab("arrange")
      if (open !== "music") onStep("music")
    }
  }
  const wordText = (i: number) => voWords[i]?.w.replace(/[^\p{L}\p{N}'’-]/gu, "") ?? ""
  const musicPins = new Map<number, string>()
  laneBlocks?.forEach((b, i) => {
    const word = typeof b.start === "object" ? b.start.word : null
    if (word !== null) musicPins.set(word, `Part ${i + 1} starts here`)
  })
  const musicMarks: ReadonlyArray<TimelineMark> = ws.project.musicTrackId === null || musicPlace === null ? [] : [
    ...(fitted?.bed.dropWord === null || fitted === null ? [] : [{ word: fitted.bed.dropWord, label: `The drop: “${wordText(fitted.bed.dropWord)}”` }]),
    ...[...musicPins].map(([word, label]) => ({ word, label: `${label}: “${wordText(word)}”` }))
  ].flatMap((m) => {
    const at = musicPlace.wordAt(m.word)
    return at === null ? [] : [{ at, label: m.label }]
  })

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
    if (open === "voice") setVoiceTab("ask")
    else if (open === "shots") setShotsTab("ask")
    else if (open === "render") setRenderTab("back")
    else if (open === "thumbnail") setThumbTab("ask")
    else if (open === "sections") setSectionsTab("ask")
    else setScriptTab("ask")
  }
  const metadata = ws.metadata
  // the post text you chose and edited, saved on the short, and publishing it again
  const publish = usePublish(ws, refresh)
  const title = publish.status?.post.title ?? metadata?.metadata.title ?? ws.project.title
  const copyPost = () => {
    if (metadata === null) return
    void navigator.clipboard.writeText(postText(publish.status?.post ?? metadata.metadata, publish.status?.credit ?? metadata.metadata.credit)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }
  const publishActions = open === "publish" && metadata !== null ? (
    <>
      <Button size="md" onClick={copyPost}>{copied ? <><Check />Copied</> : <><Copy />Copy text</>}</Button>
      {desktop === undefined ? null : (
        <Button size="md" onClick={() => void desktop?.showInFinder(metadata.files.thumbnail ?? metadata.files.folder)}><FolderOpen />Show files</Button>
      )}
    </>
  ) : null

  const actions = request !== null ? (
    <>
      {error === null ? null : <span className="text-xs text-danger">{error}</span>}
      <Button size="md" disabled={busy} onClick={askFor}>
        {open === "render" ? <><Undo2 />Send back…</> : <><MessageSquare />Ask for changes</>}
      </Button>
      <Button size="md" variant="primary" disabled={busy} onClick={gate.approve}><Check />Approve the {openStep.name.toLowerCase()}</Button>
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
          <ScriptStage script={ws.script.script} preset={ws.preset} videoUrlOf={videoUrlOf} videos={ws.videos.length} gate={gate} selected={beat} onSelect={setBeat} />
        </div>
      </>
    )
    inspector = ws.script === null ? null : (
      <ScriptInspector script={ws.script.script} limits={ws.scriptLimits} preset={ws.preset} videos={ws.videos.map((v) => v.source.title ?? "Untitled video")} stages={stages} gate={gate} tab={scriptTab} onTab={setScriptTab} />
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
            pauses={layout?.pauses ?? []}
            videos={ws.videos.length}
            onTime={onTime}
          />
        </div>
      </>
    )
    inspector = ws.voiceover === null ? null : (
      <VoiceInspector voiceover={ws.voiceover.voiceover} voiceId={ws.voiceId} stages={stages} gate={gate} onNewVoice={newVoice} tab={voiceTab} onTab={setVoiceTab} />
    )
  } else if (open === "shots") {
    if (ws.shotPlan === null) {
      stage = notYet("shot plan")
      inspector = null
    } else {
      const plan = ws.shotPlan.plan
      const k = Math.min(shotK, plan.shots.length - 1)
      const select = (next: number) => {
        setShotK(Math.max(0, Math.min(plan.shots.length - 1, next)))
        setPicking(false)
        setCandidate(null)
      }
      stage = (
        <>
          <div className="flex shrink-0 items-center gap-2 px-3.5 py-2.5">
            <Segmented<ShotsView>
              label="Stage"
              value={shotsView}
              onChange={setShotsView}
              options={[
                { value: "preview", label: <><Eye className="size-3.5" />Preview</> },
                { value: "storyboard", label: <><LayoutGrid className="size-3.5" />Storyboard</> }
              ]}
            />
            <span className="ml-auto inline-flex h-[22px] items-center rounded-chip bg-ctl px-2 text-xs text-fg-1">{ws.preset.name}</span>
            <Detail><span className="inline-flex h-[22px] items-center rounded-chip bg-ctl px-2 text-xs text-fg-1">{ws.project.approach}</span></Detail>
          </div>
          <ShotsStage
            plan={plan}
            draft={draft}
            preset={ws.preset}
            headline={ws.script?.script.headline ?? null}
            view={shotsView}
            selected={k}
            onSelect={(next) => {
              select(next)
              setShotsView("preview")
            }}
            frameOf={shotFrame}
            realFrameOf={realFrame}
            candidate={candidate === null ? null : videoStillUrl(candidate.path, candidate.source)}
            videos={ws.videos.length}
          />
        </>
      )
      inspector = (
        <ShotsInspector
          plan={plan}
          draft={draft}
          preset={ws.preset}
          selected={k}
          onSelect={select}
          onChange={(shot, change) => {
            setShotProblems([])
            setDraft((d) => new Map(d).set(shot, { ...d.get(shot), ...change }))
          }}
          frameOf={shotFrame}
          videos={pickerVideos}
          stillUrl={videoStillUrl}
          picking={picking}
          onPicking={setPicking}
          candidate={candidate}
          onCandidate={setCandidate}
          problems={shotProblems}
          onRevert={() => {
            setDraft(new Map())
            setShotProblems([])
          }}
          onSend={() => {
            void gate.edit(proposalOf(plan, draft)).then((refused) => {
              setShotProblems(refused)
              if (refused.length === 0) setDraft(new Map())
            })
          }}
          stages={stages}
          gate={gate}
          tab={shotsTab}
          onTab={setShotsTab}
        />
      )
    }
  } else if (open === "render") {
    const render = ws.render
    stage = render === null ? notYet("render") : (
      <>
        {stageBar(`${render.render.durationS.toFixed(1)}s · ${render.render.shots} shots`)}
        {render.media.video === null
          ? <div className="grid flex-1 place-items-center text-fg-2">The render's file isn't in the library.</div>
          : <ShortPlayer url={homeFileUrl(serverUrl, render.media.video)} onTime={setPlayTime} />}
      </>
    )
    inspector = render === null ? null : (
      <RenderInspector
        render={render.render}
        checkSheetUrl={render.media.checkSheet === null ? null : homeFileUrl(serverUrl, render.media.checkSheet)}
        format={ws.project.format}
        stages={stages}
        gate={gate}
        tab={renderTab}
        onTab={setRenderTab}
      />
    )
  } else if (open === "publish") {
    const video = metadata?.media.video ?? ws.render?.media.video ?? null
    stage = metadata === null ? notYet("post text") : (
      <>
        {stageBar(title)}
        {video === null
          ? <div className="grid flex-1 place-items-center text-fg-2">The published file isn't in the library.</div>
          : <ShortPlayer url={`${homeFileUrl(serverUrl, video)}?v=${metadata?.version ?? 0}`} onTime={setPlayTime} />}
      </>
    )
    inspector = metadata === null ? null : (
      <PublishInspector
        metadata={metadata.metadata}
        slug={ws.project.slug}
        source={ws.source}
        files={{
          video: metadata.media.video === null ? null : homeFileUrl(serverUrl, metadata.media.video),
          captions: metadata.media.captions === null ? null : homeFileUrl(serverUrl, metadata.media.captions),
          notes: metadata.media.notes === null ? null : homeFileUrl(serverUrl, metadata.media.notes),
          thumbnail: metadata.media.thumbnail === null ? null : homeFileUrl(serverUrl, metadata.media.thumbnail),
          folder: metadata.files.folder
        }}
        publish={publish}
        stages={stages}
        tab={publishTab}
        onTab={setPublishTab}
      />
    )
  } else if (open === "thumbnail") {
    const thumbnail = ws.thumbnail
    if (thumbnail === null) {
      stage = notYet("thumbnail")
      inspector = null
    } else {
      const config = thumbnail.thumbnail.config
      const words = thumbWords ?? wordsOf(config)
      const image = thumbnail.thumbnail.image
      stage = (
        <>
          {stageBar(`${config.lines.map((l) => l.text).join(" ")}${ws.videos.length > 1 ? ` · pictures from the first video, ${videoNames(ws.videos.map((v) => v.source.title))[0]}, for now` : ""}`)}
          <ThumbnailStage
            url={image === null ? null : artifactFileUrl(serverUrl, projectOwner, "thumbnail", thumbnail.version, image)}
            layout={config.layout ?? "classic"}
          />
        </>
      )
      inspector = (
        <ThumbnailInspector
          config={config}
          sourceId={ws.source.id}
          stillUrl={stillUrl}
          words={words}
          onWords={(next) => {
            setThumbProblems([])
            setThumbWords(next)
          }}
          problems={thumbProblems}
          onRevert={() => {
            setThumbWords(null)
            setThumbProblems([])
          }}
          onSend={() => {
            void gate.edit(withWords(config, words)).then((refused) => {
              setThumbProblems(refused)
              if (refused.length === 0) setThumbWords(null)
            })
          }}
          stages={stages}
          gate={gate}
          tab={thumbTab}
          onTab={setThumbTab}
        />
      )
    }
  } else if (open === "sections") {
    if (sections === null || ws.cutSource === null) {
      stage = notYet("sections")
      inspector = null
    } else {
      const k = Math.min(sectionK, Math.max(0, sections.sections.length - 1))
      const select = (next: number) => {
        setSectionK(Math.max(0, Math.min(sections.sections.length - 1, next)))
        setSectionPlaying(false)
      }
      const edit = (next: SectionsDraft) => {
        setSectionProblems([])
        setSectionsDraft(next)
      }
      stage = (
        <>
          <div className="flex shrink-0 items-center gap-2 px-3.5 py-2.5">
            <Segmented<SectionsView>
              label="Stage"
              value={sectionsView}
              onChange={(v) => {
                setSectionsView(v)
                setSectionPlaying(false)
              }}
              options={[
                { value: "preview", label: <><Eye className="size-3.5" />Preview</> },
                { value: "storyboard", label: <><LayoutGrid className="size-3.5" />Storyboard</> }
              ]}
            />
            <span className="ml-auto inline-flex h-[22px] items-center rounded-chip bg-ctl px-2 text-xs text-fg-1">{ws.preset.name}</span>
            <Detail><span className="inline-flex h-[22px] items-center rounded-chip bg-ctl px-2 text-xs text-fg-1">{ws.project.approach}</span></Detail>
          </div>
          <SectionsStage
            sections={sections.sections}
            preset={ws.preset}
            hookText={sections.hookText}
            view={sectionsView}
            selected={k}
            onSelect={(next) => {
              select(next)
              setSectionsView("preview")
            }}
            stillOf={sectionStill}
            sourceVideoUrl={sourceVideoUrl}
            playing={sectionPlaying}
            onPlaying={setSectionPlaying}
          />
        </>
      )
      inspector = (
        <SectionsInspector
          draft={sections}
          onDraft={edit}
          changes={planDraft === null ? 0 : changeCount(planDraft, sections)}
          preset={ws.preset}
          cut={ws.cutSource}
          selected={k}
          onSelect={select}
          stillOf={sectionStill}
          sourceVideoUrl={sourceVideoUrl}
          onPlay={() => {
            setSectionsView("preview")
            setSectionPlaying(true)
          }}
          problems={sectionProblems}
          onRevert={() => {
            setSectionsDraft(null)
            setSectionProblems([])
          }}
          onSend={() => {
            void gate.edit(sectionsProposal(sections)).then((refused) => {
              setSectionProblems(refused)
              if (refused.length === 0) setSectionsDraft(null)
            })
          }}
          stages={stages}
          gate={gate}
          tab={sectionsTab}
          onTab={setSectionsTab}
        />
      )
    }
  } else if (open === "music") {
    const track = tracks.find((t) => t.id === ws.project.musicTrackId) ?? null
    const words = ws.voiceover?.words ?? []
    const fitting = state === "running"
    const bed = fitted?.bed ?? null
    stage = (
      <>
        {stageBar(ws.project.musicTrackId === null ? "Voice only" : fitting ? "Fitting the song…" : bed === null ? "Not fitted" : `${bed.durationS.toFixed(1)}s of music under the voice`)}
        <MusicStage
          bed={arrange.heard?.bed ?? bed}
          bedUrl={arrange.heard !== null ? homeFileUrl(serverUrl, arrange.heard.media) : fitted === null ? null : homeFileUrl(serverUrl, fitted.media)}
          track={track}
          fitting={fitting}
          voiceUrl={voiceUrl}
          words={words}
          layout={layout}
          hasSongs={tracks.length > 0}
          onAddSong={() => {
            setMusicTab("song")
            setPickingSong(true)
          }}
          onTime={setBedTime}
          pins={musicPins}
          onPickWord={pickingWord && arrange.blocks !== null ? (word) => {
            arrange.edit(withBlock(arrange.blocks ?? [], arrange.selected, { start: { word } }))
            setPickingWord(false)
          } : null}
          preview={arrange.heard !== null}
        />
      </>
    )
    inspector = (
      <MusicInspector
        track={track}
        bed={bed}
        tracks={tracks}
        trackUrl={(t) => homeFileUrl(serverUrl, `music/${t.path}`)}
        words={words}
        defaultWord={ws.script === null ? null : defaultDropWord(ws.script.script, words)}
        picking={pickingSong}
        onPicking={setPickingSong}
        busy={busy}
        error={error}
        running={runGoing}
        onApply={(trackId, dropWord) => void applyMusic(trackId, dropWord)}
        stages={stages}
        tab={musicTab}
        onTab={(t) => {
          setMusicTab(t)
          setPickingWord(false)
        }}
        arrange={track === null || bed === null || bed.trackId !== track.id || fitting ? null
          : musicGrid === null || musicPlace === null ? <ArrangeUnavailable busy={arrange.busy !== null} onStart={arrange.resetToAutomatic} />
          : (
            <ArrangeInspector
              arrange={arrange}
              bed={bed}
              grid={musicGrid}
              track={track}
              trackUrl={homeFileUrl(serverUrl, `music/${track.path}`)}
              words={words}
              place={musicPlace}
              placed={draftPlaced}
              picking={pickingWord}
              onPicking={setPickingWord}
              running={runGoing}
            />
          )}
      />
    )
  } else {
    stage = <LaterStep step={openStep} milestone="a later milestone" />
    inspector = null
  }

  const captions = ws.preset.config.captions
  return (
    <ShortVideosProvider titles={ws.videos.map((v) => v.source.title)}>
      <TitleBar title={titleOf(ws)}>
        <MultiVideoNote count={ws.project.sourceIds.length} format={ws.project.format} />
        <BriefButton project={ws.project} running={(progress.run ?? ws.run)?.status === "running" || (progress.run ?? ws.run)?.status === "waiting"} onSaved={refresh} />
        {status}
      </TitleBar>
      <EditorFrame
        bar={
          <>
            <StepBar steps={steps} states={states} open={open} onOpen={onStep} />
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </>
        }
        stage={stage}
        inspector={inspector ?? <div className="p-4 text-xs text-fg-2">Nothing to inspect here yet.</div>}
        timeline={ws.project.format === "cut-down" ? (
          timelineSections === null || ws.cutSource === null ? (
            <div className="grid h-[120px] place-items-center text-xs text-fg-2">The timeline appears once the sections are planned.</div>
          ) : (
            <CutTimeline
              sections={timelineSections.sections}
              sourceSeconds={ws.cutSource.sourceSeconds}
              excluded={ws.cutSource.excluded}
              stillOf={stillOf(timelineSections)}
              selected={open === "sections" ? Math.min(sectionK, timelineSections.sections.length - 1) : null}
              onSelect={(k) => {
                setSectionK(k)
                setSectionPlaying(false)
                if (open !== "sections") onStep("sections")
              }}
              head={open === "sections"
                ? sectionBlocks(timelineSections.sections)[Math.min(sectionK, timelineSections.sections.length - 1)]?.start ?? null
                : (open === "render" || open === "publish") && playTime !== null
                ? playTime
                : null}
              captions={`${captions.enabled ? `${captions.mode === "chunk" ? `${captions.maxWords} words at a time` : "One word at a time"} · ${captions.case}` : "No captions (finish in an editor from the .srt)"}`}
            />
          )
        ) : (
          <Timeline
            layout={layout}
            head={open === "voice" && voTime !== null && layout !== null
              ? shortTimeOf(layout, voTime)
              : open === "shots" && shotBlocks !== null
              ? shotBlocks.find((b) => b.k === shotK)?.start ?? null
              : (open === "render" || open === "publish") && playTime !== null
              ? playTime
              : open === "music" && bedTime !== null
              ? bedTime
              : null}
            drop={ws.project.musicTrackId === null ? null : fitted?.bed.dropAtS ?? layout?.narration.at(-1)?.start ?? null}
            musicBlocks={ws.project.musicTrackId === null || fitted === null ? null : bedBlocks(fitted.bed)}
            musicParts={musicParts}
            marks={musicMarks}
            captions={`${captions.enabled ? `${captions.mode === "chunk" ? `${captions.maxWords} words at a time` : "One word at a time"} · ${captions.case}` : "No captions (finish in an editor from the .srt)"}`}
            music={ws.project.musicTrackId === null ? "No music · voice only" : "Music · fitted when the short is laid out"}
            shots={ws.shotPlan !== null ? `${ws.shotPlan.plan.shots.length} shots` : "Shots are planned in step 3"}
            videos={ws.videos.length}
            shotBlocks={shotBlocks === null ? null : {
              blocks: shotBlocks,
              frameOf: shotFrame,
              sourceOf: (k) => draft.get(k)?.source ?? ws.shotPlan?.plan.shots[k]?.source ?? 0,
              selected: open === "shots" ? shotK : null,
              onSelect: (k) => {
                setShotK(k)
                setPicking(false)
                setCandidate(null)
                if (open !== "shots") onStep("shots")
              }
            }}
          />
        )}
      />
    </ShortVideosProvider>
  )
}
