import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { GateResponse, MusicTrack, MusicTrackId, RankingProposal, RunRequest, SectionsProposal, ShortWorkspace, ShotProposal, StageRun, ThumbConfig, Voice } from "@viral/contracts"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { serverUrl } from "../../config/server-url.ts"
import { artifactFileUrl, artifactPathUrl } from "../../lib/media-url.ts"
import { overviewAtom } from "../home/overview.ts"
import { tracksAtom, voicesAtom } from "../library/library-api.ts"
import { useDetailed } from "../system/detail.tsx"
import type { RunProgress } from "../videos/run-progress.ts"
import { newerVideos } from "./add-video-values.ts"
import { type EditorStepId, editorSteps, layoutTimeline, openingStep, type PanelId, panelForStep, shortTimeOf, stepOfRequest, stepStates, withStoredCosts } from "./editor-values.ts"
import type { GateControls } from "./gate.ts"
import type { MusicTab } from "./music/music-inspector.tsx"
import { blockLabel, gridOf, type PlaceContext, type PlacedBlock, placeBlocks, placedFrom } from "./music/music-values.ts"
import { useArrangeDraft } from "./music/use-arrange-draft.ts"
import { usePublish } from "./publish/use-publish.ts"
import type { RankingTab } from "./ranking/ranking-inspector.tsx"
import { draftOf as rankingDraftOf, planFrame, type RankingDraft } from "./ranking/ranking-values.ts"
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
import type { ShotsView } from "./shots/shots-stage.tsx"
import { type ShotChange, shotSpans, timelineShots } from "./shots/shots-values.ts"
import type { ThumbnailWords } from "./thumbnail/thumbnail-values.ts"
import type { ClipTarget } from "./track-values.ts"
import type { Transport, TransportLink } from "./transport.ts"
import { useCaptionCues } from "./use-caption-cues.ts"
import type { LibraryTab, LibraryType } from "./library-panel-values.ts"
import type { GeneratorKind } from "./generator/generator-values.ts"

// The arrangement's parts on the Music lane, where each plays; clicking one selects it.
export interface TimelineMusicParts {
  readonly parts: ReadonlyArray<{ readonly index: number; readonly start: number; readonly end: number; readonly label: string }>
  readonly selected: number | null
  readonly onSelect: (index: number) => void
}

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
  // the panel beside the player: the open step's own, unless you picked another on the rail (kept until the step
  // changes)
  const [picked, setPicked] = useState<{ readonly step: EditorStepId; readonly panel: PanelId } | null>(null)
  const panel: PanelId = picked !== null && picked.step === open ? picked.panel : panelForStep(open)
  const setPanel = (next: PanelId) => setPicked({ step: open, panel: next })
  // the Library panel: which tab and type of item, and the selected shot's own view (Shots step)
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("short")
  const [libraryType, setLibraryType] = useState<LibraryType>("All")
  const [shotDetail, setShotDetail] = useState(false)
  // a generator opened over a panel (Library › Create, the Voice panel's Create): which, and the panel it came from
  const [generator, setGenerator] = useState<{ readonly kind: GeneratorKind; readonly from: PanelId } | null>(null)
  // the Thumbnail panel's view: its generator or its words
  const [thumbView, setThumbView] = useState<"generate" | "details">("generate")
  // the chat column's message box, focused by "Ask in chat" and "Ask for changes"
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const focusComposer = () => setTimeout(() => composer.current?.focus(), 80)
  // "Edit it myself": a new number starts editing in the step's panel (the script's selected line)
  const [editSignal, setEditSignal] = useState(0)
  const [scriptTab, setScriptTab] = useState<ScriptTab>("lines")
  const [beat, setBeat] = useState<number | null>(null)
  const [voTime, setVoTime] = useState<number | null>(null)
  // the Shots step: the selected shot, the stage's view, the frame picker, and your edit in progress
  const [shotK, setShotK] = useState(0)
  const [shotsView, setShotsView] = useState<ShotsView>("preview")
  const [picking, setPicking] = useState(false)
  const [candidate, setCandidate] = useState<PickedFrame | null>(null)
  const [draft, setDraft] = useState<ReadonlyMap<number, ShotChange>>(new Map())
  const [shotProblems, setShotProblems] = useState<ReadonlyArray<string>>([])
  // Render, Publish and Thumbnail: the inspector's tab, where the player is, and the thumbnail's words as you edit
  // them
  const [renderCheck, setRenderCheck] = useState(false)
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

  // answers a gate; the editor reloads to follow the run
  const answerRequest = (request: RunRequest, response: GateResponse) => {
    setBusy(true)
    setError(null)
    return respond({ payload: { requestId: request.id, response } })
      .then(() => refresh())
      .catch(() => setError("Couldn't send that. Is the server running?"))
      .finally(() => setBusy(false))
  }
  // what a step can do about the gate waiting on it (nothing to answer when it isn't the one waiting)
  const gateFor = (stepId: EditorStepId): GateControls => {
    const request = waitingOn === stepId ? pending : null
    const answer = (response: GateResponse) => request === null ? Promise.resolve() : answerRequest(request, response)
    return {
      request,
      busy,
      error,
      approve: () => void answer({ _tag: "Approve" }),
      ask: (note) => void answer({ _tag: "Reject", note }),
      sendBack: (note, to) => void answer({ _tag: "Reject", note, to }),
      edit: (artifact) => {
        if (request === null) return Promise.resolve(["This step isn't waiting for you."])
        // an edit is checked first where the step can, so a problem is shown instead of failing the run
        const checked = stepId === "script" && ws.script !== null
          ? check({ payload: { projectId: ws.project.id, script: artifact as typeof ws.script.script } }).then((r) => r.problems)
          : stepId === "shots"
          ? checkShots({ payload: { projectId: ws.project.id, proposal: artifact as ShotProposal } }).then((r) => r.problems)
          : stepId === "sections"
          ? checkSections({ payload: { projectId: ws.project.id, proposal: artifact as SectionsProposal } }).then((r) => r.problems)
          : stepId === "moments"
          ? checkRanking({ payload: { projectId: ws.project.id, proposal: artifact as RankingProposal } }).then((r) => r.problems)
          // choosing one of an AI round's options ({choose: n}) has nothing to check
          : stepId === "thumbnail" && !(typeof artifact === "object" && artifact !== null && "choose" in artifact)
          ? checkThumbnail({ payload: { projectId: ws.project.id, config: artifact as ThumbConfig } }).then((r) => r.problems)
          : Promise.resolve([] as ReadonlyArray<string>)
        return checked.then((problems) => problems.length > 0 ? problems : answer({ _tag: "Edit", artifact }).then(() => []))
      }
    }
  }
  const gate = gateFor(open)
  // the top bar's Approve: answers whichever step is waiting, open or not
  const approvePending = () => {
    if (pending !== null) void answerRequest(pending, { _tag: "Approve" })
  }
  // "Edit it myself" on the waiting step: open it and its panel, and start editing where the panel can
  const editItMyself = () => {
    if (waitingOn === null) return
    onStep(waitingOn)
    setPicked(null)
    if (waitingOn === "script") setScriptTab("lines")
    if (waitingOn === "shots") {
      setLibraryTab("short")
      setLibraryType("Frames")
      setShotDetail(true)
    }
    setEditSignal((n) => n + 1)
  }

  const onTime = useCallback((t: number | null) => setVoTime(t), [])
  const projectOwner = { _tag: "Project", id: ws.project.id } as const
  const voiceUrl = ws.voiceover?.path === null || ws.voiceover === null ? null : artifactPathUrl(serverUrl, projectOwner, ws.voiceover.path)
  const layout = useMemo(
    () => ws.script !== null && ws.voiceover !== null && ws.voiceover.words.length > 0
      ? layoutTimeline(ws.script.script, ws.voiceover.words, ws.voiceover.voiceover.durationS, {
        softJoins: ws.preset.config.softJoins === true,
        endCard: ws.preset.config.commentQuestion === true
      })
      : null,
    [ws.script, ws.voiceover, ws.preset.config.softJoins, ws.preset.config.commentQuestion]
  )
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
    ? timelineShots(shotSpans(ws.shotPlan.plan, ws.voiceover.words, layout.closing?.from ?? ws.voiceover.voiceover.durationS), layout)
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
    const voiceGate = waitingOn === "voice" ? pending : null
    if (voiceGate === null) return
    setBusy(true)
    setVoice({ payload: { id: ws.project.id, voiceId: voice.voiceId } })
      .then(() => answerRequest(voiceGate, { _tag: "Reject", note: `Make a new take with the voice ${voice.name.split(" - ")[0]}.` }))
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
      return p === null || p === undefined ? [] : [{ index: i, start: p.atS, end: p.endS, label: blockLabel(b, musicGrid.dropBar) }]
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
  // the timeline: the captions as they're shown, the open step's player (play/pause and seeking from the timeline),
  // and which clip is selected
  const captions = useCaptionCues({ ws, layout, sections: timelineSections, ranking, render: states.get("render") ?? "next" })
  const transport = useRef<Transport | null>(null)
  const [hasTransport, setHasTransport] = useState(false)
  const [transportPlaying, setTransportPlaying] = useState(false)
  const transportLink: TransportLink = useMemo(() => ({
    attach: (t) => {
      transport.current = t
      setHasTransport(t !== null)
      if (t === null) setTransportPlaying(false)
    },
    playing: setTransportPlaying
  }), [])
  const toggleTransport = () => transport.current?.toggle()
  const seekTransport = (shortSeconds: number) => transport.current?.seek(shortSeconds)
  // the closing question is spoken narration on the timeline
  const tagOfBeat = beat === null ? undefined : ws.script?.script.beats[beat]?._tag
  const beatTag = tagOfBeat === undefined ? null : tagOfBeat === "Real" ? "Real" as const : "Narration" as const
  const timelineSelected: ClipTarget | null = open === "shots" ? { _tag: "Shot", k: shotK }
    : open === "sections" && sections !== null ? { _tag: "Section", k: Math.min(sectionK, sections.sections.length - 1) }
    : open === "moments" ? { _tag: "Entry", rank: rankingRank, shot: null }
    : open === "music" && musicParts?.selected !== null && musicParts?.selected !== undefined ? { _tag: "Music", index: musicParts.selected }
    : panel === "script" && beat !== null && beatTag !== null ? { _tag: beatTag, beat }
    : null
  // a clip clicked on the timeline: it opens where it's edited (its step or panel), and the player jumps to it
  const selectClip = (target: ClipTarget, at: number) => {
    switch (target._tag) {
      case "Shot":
        // a shot opens in the Library panel, at its frame picker and framing
        selectShot(target.k)
        setLibraryTab("short")
        setLibraryType("Frames")
        setShotDetail(true)
        if (open !== "shots") onStep("shots")
        else setPanel("library")
        return
      case "Real":
      case "Narration":
        setScriptTab("lines")
        setBeat(target.beat)
        setPanel("script")
        break
      case "Music":
        if (target.index !== null && musicParts !== null) musicParts.onSelect(target.index)
        else setPanel("music")
        break
      case "Section":
        setSectionK(target.k)
        setSectionPlaying(false)
        if (open !== "sections") onStep("sections")
        return
      case "Entry":
        setRankingRank(target.rank)
        if (open !== "moments") onStep("moments")
        return
      case "Caption":
        setPanel("captions")
        break
    }
    seekTransport(at)
  }

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
    gateFor,
    approvePending,
    editItMyself,
    editSignal,
    // starts editing in the open panel (its own Edit button)
    startEdit: () => setEditSignal((n) => n + 1),
    panel,
    setPanel,
    generator,
    setGenerator,
    thumbView,
    setThumbView,
    libraryTab,
    setLibraryTab,
    libraryType,
    setLibraryType,
    shotDetail,
    setShotDetail,
    composer,
    focusComposer,
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
    renderCheck,
    setRenderCheck,
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
    // the timeline
    captions,
    transportLink,
    hasTransport,
    transportPlaying,
    toggleTransport,
    seekTransport,
    timelineSelected,
    selectClip
  }
}

export type EditorState = ReturnType<typeof useEditorState>
