import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { GateResponse, MusicTrack, MusicTrackId, RankingProposal, RunRequest, SectionsProposal, ShortWorkspace, ShotProposal, StageRun, ThumbConfig, Voice } from "@viral/contracts"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useCallback, useEffect, useMemo, useState } from "react"
import { serverUrl } from "../../config/server-url.ts"
import { artifactFileUrl, artifactPathUrl } from "../../lib/media-url.ts"
import { overviewAtom } from "../home/overview.ts"
import { tracksAtom, voicesAtom } from "../library/library-api.ts"
import { useDetailed } from "../system/detail.tsx"
import type { RunProgress } from "../videos/run-progress.ts"
import { newerVideos } from "./add-video-values.ts"
import { type EditorStepId, editorSteps, layoutTimeline, openingStep, shortTimeOf, stepOfRequest, stepStates, withStoredCosts } from "./editor-values.ts"
import type { GateControls } from "./gate.ts"
import type { MusicTab } from "./music/music-inspector.tsx"
import { blockLabel, gridOf, loopTicks, type PlaceContext, type PlacedBlock, placeBlocks, placedFrom } from "./music/music-values.ts"
import { useArrangeDraft } from "./music/use-arrange-draft.ts"
import type { PublishTab } from "./publish/publish-inspector.tsx"
import { usePublish } from "./publish/use-publish.ts"
import type { RankingTab } from "./ranking/ranking-inspector.tsx"
import { draftOf as rankingDraftOf, planFrame, type RankingDraft } from "./ranking/ranking-values.ts"
import type { RenderTab } from "./render/render-inspector.tsx"
import type { ScriptTab } from "./script/script-inspector.tsx"
import type { SectionsTab } from "./sections/sections-inspector.tsx"
import type { SectionsView } from "./sections/sections-stage.tsx"
import { draftOf, type SectionsDraft, stillKey } from "./sections/sections-values.ts"
import {
  cancelRun,
  checkRankingEdit,
  checkScriptEdit,
  checkSectionsEdit,
  checkShotsEdit,
  checkThumbnailEdit,
  musicBedAtom,
  refitMusic,
  respondToRequest,
  setProjectVoice,
  stillAt
} from "./shorts-api.ts"
import type { PickedFrame, PickerVideo } from "./shots/frame-picker.tsx"
import type { ShotsTab } from "./shots/shots-inspector.tsx"
import type { ShotsView } from "./shots/shots-stage.tsx"
import { type ShotChange, shotSpans, timelineShots } from "./shots/shots-values.ts"
import type { ThumbnailTab } from "./thumbnail/thumbnail-inspector.tsx"
import type { ThumbnailWords } from "./thumbnail/thumbnail-values.ts"
import type { TimelineMark, TimelineMusicParts } from "./timeline.tsx"
import type { VoiceTab } from "./voice/voice-inspector.tsx"

// Everything the short's editor knows and can do, for every step at once: the steps and where they stand, the gate
// controls, each step's selection and edit in progress, and the media the steps show. The step views read from it.
export function useEditorState({ ws, progress, step, onStep, refresh }: {
  readonly ws: ShortWorkspace
  readonly progress: RunProgress
  readonly step: EditorStepId | undefined
  readonly onStep: (step: EditorStepId) => void
  readonly refresh: () => void
}) {
  // the live run is fresher than the last workspace load
  const stages: ReadonlyArray<StageRun> = useMemo(
    () => progress.run === null ? ws.stages : withStoredCosts(progress.stages, ws.stages),
    [progress.run, progress.stages, ws.stages]
  )
  const pending: RunRequest | null = progress.run === null ? ws.pending : progress.pending[0] ?? null
  const steps = editorSteps(ws.project.format)
  const states = useMemo(() => stepStates(steps, stages), [steps, stages])
  const open = step !== undefined && steps.some((s) => s.id === step) ? step : openingStep(steps, states)
  const openStep = steps.find((s) => s.id === open)!
  const waitingOn = stepOfRequest(steps, pending)
  const current = openingStep(steps, states)
  // a video just added by link is read in its own run; once the library has its title, reload the short to name it
  const library = Option.getOrNull(AsyncResult.value(useAtomValue(overviewAtom)))
  const newer = newerVideos(ws.videos.map((v) => v.source), library?.videos.map((v) => v.source) ?? [])
  useEffect(() => {
    if (newer !== "") refresh()
  }, [newer, refresh])

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
  // stills fetched for sections whose start you moved (by video and source second, stillKey)
  const [sectionK, setSectionK] = useState(0)
  const [sectionsView, setSectionsView] = useState<SectionsView>("preview")
  const [sectionsTab, setSectionsTab] = useState<SectionsTab>("section")
  const [sectionsDraft, setSectionsDraft] = useState<SectionsDraft | null>(null)
  const [sectionProblems, setSectionProblems] = useState<ReadonlyArray<string>>([])
  const [sectionPlaying, setSectionPlaying] = useState(false)
  const [stills, setStills] = useState<ReadonlyMap<string, string>>(new Map())
  const checkSections = useAtomSet(checkSectionsEdit, { mode: "promise" })
  // the Ranking step (rankings): the selected entry (its rank), the inspector's tab, your edit in progress (snapped
  // by the server as you change shots), its problems and length as last checked
  const [rankingRank, setRankingRank] = useState(1)
  const [rankingTab, setRankingTab] = useState<RankingTab>("ranks")
  const [rankingDraft, setRankingDraft] = useState<RankingDraft | null>(null)
  const [rankingProblems, setRankingProblems] = useState<ReadonlyArray<string>>([])
  const [rankingChecking, setRankingChecking] = useState(false)
  const [rankingLength, setRankingLength] = useState<number | null>(null)
  const checkRanking = useAtomSet(checkRankingEdit, { mode: "promise" })
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
        : open === "moments"
        ? checkRanking({ payload: { projectId: ws.project.id, proposal: artifact as RankingProposal } }).then((r) => r.problems)
        : open === "thumbnail"
        ? checkThumbnail({ payload: { projectId: ws.project.id, config: artifact as ThumbConfig } }).then((r) => r.problems)
        : Promise.resolve([] as ReadonlyArray<string>)
      return checked.then((problems) => problems.length > 0 ? problems : answer({ _tag: "Edit", artifact }).then(() => []))
    }
  }

  const onTime = useCallback((t: number | null) => setVoTime(t), [])
  const projectOwner = { _tag: "Project", id: ws.project.id } as const
  const voiceUrl = ws.voiceover?.path === null || ws.voiceover === null ? null : artifactPathUrl(serverUrl, projectOwner, ws.voiceover.path)
  const layout = ws.script !== null && ws.voiceover !== null && ws.voiceover.words.length > 0
    ? layoutTimeline(ws.script.script, ws.voiceover.words, ws.voiceover.voiceover.durationS)
    : null
  // the short's videos (the first one first): each one's file, and a still of it, by position
  const videoOf = (source: number) => ws.videos[source] ?? ws.videos[0]
  const videoUrlOf = (source: number) => {
    const v = videoOf(source)
    return v === undefined || v.video === null ? null : artifactPathUrl(serverUrl, { _tag: "Source", id: v.source.id }, v.video)
  }
  const videoStillUrl = (path: string, source: number) => artifactPathUrl(serverUrl, { _tag: "Source", id: videoOf(source)?.source.id ?? ws.source.id }, path)
  const pickerVideos: ReadonlyArray<PickerVideo> = ws.videos.map((v) => ({ sourceId: v.source.id, title: v.source.title ?? "Untitled video", seconds: v.seconds }))
  // a shot's image: the still you picked for it, else its planned frame next to the shot plan
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
  // selects a shot (clamped to the plan), closing the frame picker
  const selectShot = (next: number) => {
    const count = ws.shotPlan?.plan.shots.length ?? 1
    setShotK(Math.max(0, Math.min(count - 1, next)))
    setPicking(false)
    setCandidate(null)
  }
  // a cut-down short's sections: your edit in progress, else the plan's
  const planDraft = useMemo(() => (ws.cutPlan === null ? null : draftOf(ws.cutPlan.plan)), [ws.cutPlan])
  const sections = sectionsDraft ?? planDraft
  // the timeline shows your edit only on the Sections step; the other steps show what was rendered
  const timelineSections = open === "sections" ? sections : planDraft
  const stillOf = (draft: SectionsDraft | null) => (k: number) => {
    const section = draft?.sections[k]
    if (section === undefined || ws.cutPlan === null) return null
    if (section.frame !== null) return artifactFileUrl(serverUrl, projectOwner, "cut-plan", ws.cutPlan.version, section.frame)
    const still = stills.get(stillKey(section.source, section.start))
    return still === undefined ? null : videoStillUrl(still, section.source ?? 0)
  }
  const sectionStill = stillOf(sections)
  // a section whose start moved, or that you added, gets a still of its own video at its new start
  const missing = sections?.sections
    .filter((s) => s.frame === null && !stills.has(stillKey(s.source, s.start)))
    .map((s) => ({ key: stillKey(s.source, s.start), source: s.source ?? 0, t: Math.round(s.start) })) ?? []
  const missingKey = missing.map((m) => m.key).join(",")
  useEffect(() => {
    for (const { key, source, t } of missing) {
      void fetchStill({ payload: { sourceId: videoOf(source)?.source.id ?? ws.source.id, t, span: 0, every: 1 } })
        .then((r) => {
          const frame = r.frames[0]
          if (frame !== undefined) setStills((m) => new Map(m).set(key, frame.path))
        })
        .catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the set of missing starts changes
  }, [missingKey])
  // a ranking's moments: your edit in progress, else the plan's; a shot you moved gets a still at its new start
  const rankingPlan = ws.rankingPlan ?? null
  const rankingPlanDraft = useMemo(() => (rankingPlan === null ? null : rankingDraftOf(rankingPlan.plan)), [rankingPlan])
  const ranking = open === "moments" ? rankingDraft ?? rankingPlanDraft : rankingPlanDraft
  const rankingStillOf = (rank: number, k: number) => {
    const entry = ranking?.entries.find((e) => e.rank === rank)
    const shot = entry?.shots[k]
    if (entry === undefined || shot === undefined || rankingPlan === null) return null
    const frame = planFrame(rankingPlan.plan, entry.source ?? 0, shot, "first")
    if (frame !== null) return artifactFileUrl(serverUrl, projectOwner, "ranking-plan", rankingPlan.version, frame)
    const still = stills.get(stillKey(entry.source, shot.start))
    return still === undefined ? null : videoStillUrl(still, entry.source ?? 0)
  }
  const rankingMissing = rankingPlan === null || ranking === null ? [] : ranking.entries.flatMap((e) =>
    e.shots
      .filter((s) => planFrame(rankingPlan.plan, e.source ?? 0, s, "first") === null && !stills.has(stillKey(e.source, s.start)))
      .map((s) => ({ key: stillKey(e.source, s.start), source: e.source ?? 0, t: Math.round(s.start) })))
  const rankingMissingKey = rankingMissing.map((m) => m.key).join(",")
  useEffect(() => {
    for (const { key, source, t } of rankingMissing) {
      void fetchStill({ payload: { sourceId: videoOf(source)?.source.id ?? ws.source.id, t, span: 0, every: 1 } })
        .then((r) => {
          const frame = r.frames[0]
          if (frame !== undefined) setStills((m) => new Map(m).set(key, frame.path))
        })
        .catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the set of missing starts changes
  }, [rankingMissingKey])
  // a change to the ranking; one that moves a shot is checked at once, so its times come back snapped to whole
  // sentences (and its framing detected for the new moment)
  const editRanking = (next: RankingDraft, snap = false) => {
    setRankingProblems([])
    setRankingDraft(next)
    if (!snap) return
    setRankingChecking(true)
    void checkRanking({ payload: { projectId: ws.project.id, proposal: next } })
      .then((r) => {
        setRankingDraft(r.proposal)
        setRankingProblems(r.problems)
        setRankingLength(r.durationS)
      })
      .catch(() => setRankingProblems(["Couldn't check the change. Is the server running?"]))
      .finally(() => setRankingChecking(false))
  }
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
  // stops the run that's going (if any) before a change that re-runs the short
  const stopRun = () => (runGoing && liveRun !== null ? cancel({ payload: { runId: liveRun.id } }) : Promise.resolve(true))
  // changes the song (null: no music) and/or the drop word, stopping a run that's going, then follows the re-run
  const applyMusic = (trackId: MusicTrackId | null, dropWord: number | null | undefined) => {
    setBusy(true)
    setError(null)
    return stopRun()
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
    stopRun,
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

  // the post text you chose and edited, saved on the short, and publishing it again
  const publish = usePublish(ws, refresh)
  const going = liveRun?.status === "running" || liveRun?.status === "waiting"

  return {
    ws,
    progress,
    onStep,
    refresh,
    stages,
    pending,
    steps,
    states,
    open,
    openStep,
    waitingOn,
    current,
    state,
    working,
    going,
    runGoing,
    liveRun,
    stopRun,
    busy,
    setBusy,
    error,
    setError,
    gate,
    projectOwner,
    voices,
    voiceName,
    voiceUrl,
    layout,
    videoUrlOf,
    videoStillUrl,
    pickerVideos,
    // script and voice
    scriptTab,
    setScriptTab,
    voiceTab,
    setVoiceTab,
    beat,
    setBeat,
    voTime,
    onTime,
    newVoice,
    // shots
    shotK,
    setShotK,
    selectShot,
    shotsView,
    setShotsView,
    shotsTab,
    setShotsTab,
    picking,
    setPicking,
    candidate,
    setCandidate,
    draft,
    setDraft,
    shotProblems,
    setShotProblems,
    shotFrame,
    realFrame,
    shotBlocks,
    // render, publish, thumbnail
    renderTab,
    setRenderTab,
    publishTab,
    setPublishTab,
    thumbTab,
    setThumbTab,
    playTime,
    setPlayTime,
    thumbWords,
    setThumbWords,
    thumbProblems,
    setThumbProblems,
    copied,
    setCopied,
    publish,
    // sections
    sectionK,
    setSectionK,
    sectionsView,
    setSectionsView,
    sectionsTab,
    setSectionsTab,
    sectionsDraft,
    setSectionsDraft,
    sectionProblems,
    setSectionProblems,
    sectionPlaying,
    setSectionPlaying,
    planDraft,
    sections,
    timelineSections,
    stillOf,
    sectionStill,
    // ranking
    rankingRank,
    setRankingRank,
    rankingTab,
    setRankingTab,
    rankingDraft,
    setRankingDraft,
    rankingProblems,
    setRankingProblems,
    rankingChecking,
    rankingLength,
    setRankingLength,
    rankingPlan,
    rankingPlanDraft,
    ranking,
    rankingStillOf,
    editRanking,
    // music
    fitted,
    tracks,
    musicTab,
    setMusicTab,
    pickingSong,
    setPickingSong,
    bedTime,
    setBedTime,
    applyMusic,
    arrange,
    pickingWord,
    setPickingWord,
    musicPlace,
    musicGrid,
    draftPlaced,
    musicParts,
    musicPins,
    musicMarks
  }
}

export type EditorState = ReturnType<typeof useEditorState>
