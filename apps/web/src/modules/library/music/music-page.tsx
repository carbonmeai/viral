import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import type { MusicTrack, MusicTrackKind, Project, Rights } from "@viral/contracts"
import { Button, buttonVariants } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Panel } from "@viral/ui/primitives/panel"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Select } from "@viral/ui/primitives/select"
import { Skeleton, SkeletonRegion, SkeletonText } from "@viral/ui/primitives/skeleton"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { FolderOpen, Music, Pause, Play, Plus, RefreshCw, SkipForward, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { desktop, serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { overviewAtom } from "../../home/overview.ts"
import { Page } from "../../layout/page.tsx"
import { EDITOR_STEP_IDS } from "../../shorts/editor-values.ts"
import { Detail } from "../../system/detail.tsx"
import { addMusicFolder, addMusicTrack, analyseMusicTrack, removeMusicTrack, setMusicTrackBeat, setMusicTrackKind, setMusicTrackRights, tracksAtom } from "../library-api.ts"
import { Loaded } from "../library-loading.tsx"
import { buildStart, fileName, musicStep, pathKind, refusal, shortsByTrack, trackLength } from "../library-values.ts"
import { TrackWaveform } from "./track-waveform.tsx"

const RIGHTS: ReadonlyArray<{ readonly value: Rights; readonly label: string }> = [
  { value: "owned", label: "Mine" },
  { value: "licensed", label: "Licensed" },
  { value: "unconfirmed", label: "Not confirmed" }
]

const KINDS: ReadonlyArray<{ readonly value: MusicTrackKind; readonly label: string }> = [
  { value: "song", label: "Full song" },
  { value: "clip", label: "Edited clip" }
]

// What's being added: songs or a folder chosen in the open panel, or (in a browser) a typed path.
type Adding = { readonly _tag: "files"; readonly files: ReadonlyArray<string> } | { readonly _tag: "folder"; readonly folder: string } | { readonly _tag: "typed" }

const MUSIC_STEP = musicStep(EDITOR_STEP_IDS)

// Library › Music: tracks you can put under a short, with their tempo and drop. Music is optional; a short
// without a track is voice only.
export function MusicPage() {
  const tracks = useAtomValue(tracksAtom)
  const overview = useAtomValue(overviewAtom)
  const projects = Option.getOrElse(Option.map(AsyncResult.value(overview), (o) => o.shorts.map((s) => s.project)), (): ReadonlyArray<Project> => [])
  const [adding, setAdding] = useState<Adding | null>(null)
  const addSongs = () => {
    if (desktop === undefined) return setAdding({ _tag: "typed" })
    void desktop.openFiles("audio").then((files) => files.length === 0 ? undefined : setAdding({ _tag: "files", files }))
  }
  const addFolder = () => {
    if (desktop === undefined) return setAdding({ _tag: "typed" })
    void desktop.openFolder().then((folder) => folder === null ? undefined : setAdding({ _tag: "folder", folder }))
  }
  const buttons = (
    <>
      <Button size="md" onClick={addFolder}><FolderOpen />Add a folder</Button>
      <Button size="md" variant="primary" onClick={addSongs}><Plus />Add songs</Button>
    </>
  )
  return (
    <Page
      title="Music"
      description="Songs for your shorts, with their tempo and drop. Music is optional: a short without a song is voice only."
      actions={buttons}
    >
      <div className="grid gap-2">
        {adding === null ? null : <AddTracks key={JSON.stringify(adding)} adding={adding} onDone={() => setAdding(null)} />}
        <Loaded result={tracks} skeleton={<MusicSkeleton />}>
          {(list) => list.length === 0
            ? adding === null
              ? (
                <Panel title="Songs" count={0}>
                  <div className="grid justify-items-start gap-3 px-1 py-3">
                    <div className="max-w-[460px] text-fg-2">Add songs you own or have rights to. Viral finds their tempo and drop, and fits them to each short.</div>
                    <div className="flex gap-1.5">{buttons}</div>
                  </div>
                </Panel>
              )
              : null
            : <TrackList tracks={list} usedBy={shortsByTrack(list, projects)} />}
        </Loaded>
      </div>
    </Page>
  )
}

// The song list while it loads: rows like the real ones, the first open with its waveform bars.
function MusicSkeleton() {
  return (
    <SkeletonRegion label="Loading your music" className="rounded-panel bg-panel px-4 pt-3.5 pb-4">
      <Skeleton className="mb-3.5 h-4 w-20" />
      <div className="flex flex-col gap-[3px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-[8px] bg-item">
            <div className="flex min-h-12 items-center gap-3 px-3 py-2">
              <Skeleton className="size-8 rounded-[6px]" />
              <SkeletonText lines={2} className="w-56" />
              <Skeleton className="ml-auto h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
            {i === 0
              ? (
                <div className="grid gap-3 px-3 pt-1 pb-3">
                  <div className="flex h-16 items-center gap-[2px]">
                    {Array.from({ length: 140 }, (_, b) => (
                      <Skeleton key={b} className="flex-1 rounded-[1px]" style={{ height: `${20 + 60 * Math.abs(Math.sin(b * 0.37) * Math.cos(b * 0.11))}%` }} />
                    ))}
                  </div>
                  <div className="flex gap-1.5"><Skeleton className="h-7 w-20 rounded-ctl" /><Skeleton className="h-7 w-36 rounded-ctl" /></div>
                </div>
              )
              : null}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

function TrackList({ tracks, usedBy }: { readonly tracks: ReadonlyArray<MusicTrack>; readonly usedBy: ReadonlyMap<string, ReadonlyArray<Project>> }) {
  const [open, setOpen] = useState<string | null>(tracks[0]?.id ?? null)
  return (
    <Panel title="Songs" count={tracks.length}>
      {tracks.map((track) => (
        <TrackRow key={track.id} track={track} usedBy={usedBy.get(track.id) ?? []} open={open === track.id} onToggle={() => setOpen(open === track.id ? null : track.id)} />
      ))}
    </Panel>
  )
}

function TrackRow({ track, usedBy, open, onToggle }: { readonly track: MusicTrack; readonly usedBy: ReadonlyArray<Project>; readonly open: boolean; readonly onToggle: () => void }) {
  const beat = track.bpm === null ? "No beat yet" : `${track.bpm.toFixed(1)} BPM${track.dropS === null ? " · no drop" : ` · drop ${trackLength(track.dropS)}`}`
  return (
    <div className="rounded-[8px] bg-item">
      <button type="button" onClick={onToggle} className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-item-hover">
        <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-ctl text-fg-2 [&>svg]:size-4"><Music /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{track.title}</span>
          <span className="text-xs text-fg-2">
            {trackLength(track.durationS)} · {beat}
            <Detail>
              {track.loudnessLufs === null ? "" : ` · ${track.loudnessLufs.toFixed(1)} LUFS`}
              {track.beatSource === null ? "" : ` · ${track.beatSource === "manual" ? "set by you" : "from analysis"}`}
            </Detail>
          </span>
        </span>
        <span className="rounded-[6px] bg-ctl px-1.5 py-0.5 text-xs text-fg-2">{KINDS.find((k) => k.value === track.kind)?.label}</span>
        {usedBy.length === 0 ? null : <span className="text-xs text-fg-2">{usedBy.length === 1 ? "1 short" : `${usedBy.length} shorts`}</span>}
        <Status tone={track.rights === "unconfirmed" ? "wait" : "ok"}>{RIGHTS.find((r) => r.value === track.rights)?.label}</Status>
      </button>
      {open ? <TrackDetails track={track} usedBy={usedBy} /> : null}
    </div>
  )
}

// The open track: its waveform with the drop, playback from the start or the build-up, its beat, rights and
// the shorts that use it.
function TrackDetails({ track, usedBy }: { readonly track: MusicTrack; readonly usedBy: ReadonlyArray<Project> }) {
  const url = homeFileUrl(serverUrl, `music/${track.path}`)
  const analyse = useAtomSet(analyseMusicTrack, { mode: "promise" })
  const setBeat = useAtomSet(setMusicTrackBeat, { mode: "promise" })
  const setRights = useAtomSet(setMusicTrackRights, { mode: "promise" })
  const setKind = useAtomSet(setMusicTrackKind, { mode: "promise" })
  const remove = useAtomSet(removeMusicTrack, { mode: "promise" })
  const audio = useRef<HTMLAudioElement | null>(null)
  const [time, setTime] = useState<number | null>(null)
  const [bpm, setBpm] = useState(track.bpm === null ? "" : String(track.bpm))
  const [drop, setDrop] = useState(track.dropS === null ? "" : String(track.dropS))
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const build = buildStart(track)

  useEffect(() => () => audio.current?.pause(), [])
  const play = (from: number) => {
    if (audio.current === null) {
      audio.current = new Audio(url)
      audio.current.ontimeupdate = () => setTime(audio.current?.currentTime ?? null)
      audio.current.onended = () => setTime(null)
    }
    audio.current.currentTime = from
    void audio.current.play()
  }
  const stop = () => {
    audio.current?.pause()
    setTime(null)
  }
  const run = (what: string, task: Promise<unknown>) => {
    setBusy(what)
    setProblem(null)
    void task.catch((e: unknown) => setProblem(refusal(e)[0] ?? null)).finally(() => setBusy(null))
  }
  const bpmValue = Number(bpm)
  const dropValue = Number(drop)
  const beatValid = bpm !== "" && drop !== "" && bpmValue > 0 && dropValue >= 0

  return (
    <div className="grid gap-3 px-3 pt-1 pb-3">
      <TrackWaveform url={url} durationS={track.durationS} dropS={track.dropS} buildS={build} time={time} onSeek={play} />
      <div className="flex flex-wrap items-center gap-1.5">
        {time === null ? <Button onClick={() => play(0)}><Play />Play</Button> : <Button onClick={stop}><Pause />Stop</Button>}
        {build === null ? null : <Button variant="ghost" onClick={() => play(build)}><SkipForward />From the build-up</Button>}
        <span className="mx-2 h-5 w-px bg-line" />
        <Input aria-label="BPM" inputMode="decimal" className="w-[72px] text-right" placeholder="BPM" value={bpm} onChange={(e) => setBpm(e.currentTarget.value)} />
        <Input aria-label="Drop at (seconds)" inputMode="decimal" className="w-[88px] text-right" placeholder="drop (s)" value={drop} onChange={(e) => setDrop(e.currentTarget.value)} />
        <Button
          disabled={!beatValid || busy !== null || (bpmValue === track.bpm && dropValue === track.dropS)}
          onClick={() => run("beat", setBeat({ payload: { id: track.id, bpm: bpmValue, dropS: dropValue }, reactivityKeys: ["music"] }))}
        >
          Set beat
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={() => run("analyse", analyse({ payload: { id: track.id }, reactivityKeys: ["music"] }))}>
          <RefreshCw />{busy === "analyse" ? "Analysing…" : "Analyse again"}
        </Button>
        <span className="ml-auto flex items-center gap-1.5">
          <Segmented label="Type" value={track.kind} options={KINDS} onChange={(kind) => run("kind", setKind({ payload: { id: track.id, kind }, reactivityKeys: ["music"] }))} />
          <Select label="Rights" className="min-w-[132px]" value={track.rights} options={RIGHTS} onChange={(rights) => run("rights", setRights({ payload: { id: track.id, rights }, reactivityKeys: ["music"] }))} />
          {confirming
            ? (
              <>
                <Button className="text-danger" onClick={() => run("remove", remove({ payload: { id: track.id }, reactivityKeys: ["music"] }))}>Remove</Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
              </>
            )
            : <Button variant="ghost" aria-label={`Remove ${track.title}`} onClick={() => setConfirming(true)}><Trash2 /></Button>}
        </span>
      </div>
      {track.beatSource === "manual" ? <div className="text-xs text-fg-2">You set this beat, so analysing again keeps it.</div> : null}
      {problem === null ? null : <div className="text-xs text-danger">{problem}</div>}
      {usedBy.length === 0 ? null : (
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-2">
            Used by
            {usedBy.map((p) => (
              <Link
                key={p.id}
                to="/shorts/$projectId"
                params={{ projectId: p.id }}
                search={MUSIC_STEP === undefined ? {} : { step: MUSIC_STEP }}
                className={buttonVariants({ variant: "ghost" })}
              >
                {p.title}
              </Link>
            ))}
          </div>
          <div className="text-xs text-fg-3">Each short uses its own fitted cut of this song; the song itself is never changed.</div>
        </div>
      )}
    </div>
  )
}

// Adding songs: the files or folder chosen in the open panel (a typed path in a browser), and their rights.
// A folder adds every audio file in it; files Viral can't read are listed, the rest are added.
function AddTracks({ adding, onDone }: { readonly adding: Adding; readonly onDone: () => void }) {
  const add = useAtomSet(addMusicTrack, { mode: "promise" })
  const addFolder = useAtomSet(addMusicFolder, { mode: "promise" })
  const [typed, setTyped] = useState("")
  const [title, setTitle] = useState("")
  const [rights, setRights] = useState<Rights>("unconfirmed")
  const [problem, setProblem] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<ReadonlyArray<{ readonly file: string; readonly reason: string }> | null>(null)
  const [saving, setSaving] = useState(false)
  const target: Adding = adding._tag !== "typed" || typed.trim() === ""
    ? adding
    : pathKind(typed) === "file" ? { _tag: "files", files: [typed.trim()] } : { _tag: "folder", folder: typed.trim() }
  const single = target._tag === "files" && target.files.length === 1
  const save = async () => {
    if (target._tag === "folder") {
      const result = await addFolder({ payload: { folder: target.folder, rights }, reactivityKeys: ["music"] })
      if (result.skipped.length > 0) return setSkipped(result.skipped)
    } else if (target._tag === "files") {
      for (const file of target.files) {
        await add({ payload: { file, title: single && title.trim() !== "" ? title.trim() : null, rights }, reactivityKeys: ["music"] })
      }
    }
    onDone()
  }
  if (skipped !== null) {
    return (
      <Panel title="Added, with some files skipped">
        <div className="grid gap-2 px-1 pb-1">
          {skipped.map((s) => <div key={s.file} className="text-xs text-fg-2"><span className="text-fg">{fileName(s.file)}</span> · {s.reason}</div>)}
          <div><Button onClick={onDone}>Done</Button></div>
        </div>
      </Panel>
    )
  }
  return (
    <Panel title={target._tag === "folder" ? "Add a folder" : single ? "Add a song" : "Add songs"}>
      <div className="grid gap-2 px-1 pb-1">
        {adding._tag === "typed"
          ? <Input aria-label="Song or folder" placeholder="/path/to/song.mp3 or /path/to/folder" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} />
          : (
            <div className="text-xs text-fg-2">
              {target._tag === "folder"
                ? <>Every song in <span className="text-fg">{target.folder}</span></>
                : target._tag === "files" ? target.files.map(fileName).join(", ") : null}
            </div>
          )}
        <div className="flex items-center gap-1.5">
          {single ? <Input aria-label="Title" className="flex-1" placeholder="Title (optional: the file name)" value={title} onChange={(e) => setTitle(e.currentTarget.value)} /> : <span className="flex-1" />}
          <Select label="Rights" className="min-w-[132px]" value={rights} options={RIGHTS} onChange={setRights} />
          <Button
            variant="primary"
            disabled={target._tag === "typed" || saving}
            onClick={() => {
              setSaving(true)
              setProblem(null)
              void save().catch((e: unknown) => setProblem(refusal(e)[0] ?? null)).finally(() => setSaving(false))
            }}
          >
            {saving ? "Adding…" : "Add"}
          </Button>
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
        <div className="text-xs text-fg-2">Viral copies the files into your library and works out their tempo and drop in the background.</div>
        {problem === null ? null : <div className="text-xs text-danger">{problem}</div>}
      </div>
    </Panel>
  )
}
