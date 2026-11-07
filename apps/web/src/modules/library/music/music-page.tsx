import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import type { MusicTrack, MusicTrackKind, Project, Rights } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Input } from "@viral/ui/primitives/input"
import { Menu, MenuChoices, MenuItem, MenuNote, MenuSeparator, MenuSub } from "@viral/ui/primitives/menu"
import { Panel } from "@viral/ui/primitives/panel"
import { Select } from "@viral/ui/primitives/select"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { FolderOpen, Play, Plus, Square, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { desktop, serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { overviewAtom } from "../../home/overview.ts"
import { Page } from "../../layout/page.tsx"
import { EDITOR_STEP_IDS } from "../../shorts/editor-values.ts"
import { Detail } from "../../system/detail.tsx"
import { addMusicFolder, addMusicTrack, removeMusicTrack, setMusicTrackKind, setMusicTrackRights, tracksAtom } from "../library-api.ts"
import { Loaded } from "../library-loading.tsx"
import { fileName, musicStep, pathKind, refusal, shortsByTrack, trackLength } from "../library-values.ts"

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

// Library › Music: the songs you can put under a short, as a plain list: play one, see its length and tempo,
// which shorts use it, its rights. Rights, type and Remove sit in each row's ⋯ menu; fitting a song to a short
// happens in that short's Music step. Music is optional; a short without a song is voice only.
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
      description="Songs for your shorts. Music is optional: a short without a song is voice only."
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

// Every song row: play, the title, its length and tempo, the shorts using it, its rights, and a ⋯ menu.
const ROW = "grid grid-cols-[28px_minmax(0,1fr)_48px_72px_88px_112px_28px] items-center gap-3"

// The song list while it loads: rows like the real ones.
function MusicSkeleton() {
  return (
    <SkeletonRegion label="Loading your music" className="rounded-panel bg-panel px-4 pt-3.5 pb-4">
      <Skeleton className="mb-3.5 h-4 w-20" />
      <div className="flex flex-col gap-[3px]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn(ROW, "min-h-12 rounded-[8px] bg-item px-3 py-2")}>
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-3.5 w-[55%]" />
            <Skeleton className="h-3.5 w-9" />
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-5 w-16 rounded-chip" />
            <Skeleton className="size-7" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

// Only one song plays at a time across the page.
let playingNow: HTMLAudioElement | null = null

function TrackList({ tracks, usedBy }: { readonly tracks: ReadonlyArray<MusicTrack>; readonly usedBy: ReadonlyMap<string, ReadonlyArray<Project>> }) {
  useEffect(() => () => {
    playingNow?.pause()
    playingNow = null
  }, [])
  return (
    <Panel title="Songs" count={tracks.length}>
      {tracks.map((track) => <TrackRow key={track.id} track={track} usedBy={usedBy.get(track.id) ?? []} />)}
    </Panel>
  )
}

function PlayButton({ track }: { readonly track: MusicTrack }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = () => {
    if (audio.current === null) {
      audio.current = new Audio(homeFileUrl(serverUrl, `music/${track.path}`))
      audio.current.onended = () => setPlaying(false)
      audio.current.onpause = () => setPlaying(false)
    }
    if (playing) {
      audio.current.pause()
      audio.current.currentTime = 0
      return
    }
    if (playingNow !== null && playingNow !== audio.current) playingNow.pause()
    playingNow = audio.current
    void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  return (
    <IconButton
      label={playing ? `Stop ${track.title}` : `Play ${track.title}`}
      variant="default"
      onClick={toggle}
      className={cn("rounded-full", playing && "bg-lemon text-lemon-ink hover:bg-lemon")}
    >
      {playing ? <Square className="fill-current" /> : <Play className="fill-current" />}
    </IconButton>
  )
}

function TrackRow({ track, usedBy }: { readonly track: MusicTrack; readonly usedBy: ReadonlyArray<Project> }) {
  const navigate = useNavigate()
  const setRights = useAtomSet(setMusicTrackRights, { mode: "promise" })
  const setKind = useAtomSet(setMusicTrackKind, { mode: "promise" })
  const remove = useAtomSet(removeMusicTrack, { mode: "promise" })
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const run = (task: Promise<unknown>) => {
    setProblem(null)
    void task.catch((e: unknown) => setProblem(refusal(e)[0] ?? null))
  }
  const openShort = (project: Project) =>
    void navigate({ to: "/shorts/$projectId", params: { projectId: project.id }, search: MUSIC_STEP === undefined ? {} : { step: MUSIC_STEP } })

  return (
    <div className="rounded-[8px] bg-item hover:bg-item-hover">
      <div className={cn(ROW, "min-h-12 px-3 py-2")}>
        <PlayButton track={track} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium" title={track.title}>{track.title}</span>
          {track.kind === "clip" ? <span className="text-xs text-fg-2">Edited clip</span> : null}
          <Detail>
            <span className="truncate text-xs text-fg-3">
              {[
                track.dropS === null ? "no drop found" : `drop at ${trackLength(track.dropS)}`,
                track.loudnessLufs === null ? null : `${track.loudnessLufs.toFixed(1)} LUFS`,
                track.beatSource === "manual" ? "beat set by you" : null
              ].filter((part) => part !== null).join(" · ")}
            </span>
          </Detail>
        </span>
        <span className="text-fg-1 tabular-nums">{trackLength(track.durationS)}</span>
        <span className={cn("tabular-nums", track.bpm === null ? "text-fg-3" : "text-fg-1")} title={track.bpm === null ? "Viral works out the tempo after a song is added" : "Tempo"}>
          {track.bpm === null ? "—" : `${Math.round(track.bpm)} BPM`}
        </span>
        <span className="min-w-0">
          {usedBy.length === 0 ? <span className="text-fg-3">Not used</span> : (
            <Menu label={`Shorts using ${track.title}`} align="start" trigger={plural(usedBy.length, "short")} triggerClassName="-ml-2.5 text-base font-normal text-fg-1">
              <MenuNote>Each uses its own fitted cut; the song isn’t changed.</MenuNote>
              {usedBy.map((p) => <MenuItem key={p.id} onClick={() => openShort(p)}><span className="truncate">{p.title}</span></MenuItem>)}
            </Menu>
          )}
        </span>
        <span><Status tone={track.rights === "unconfirmed" ? "wait" : "ok"}>{RIGHTS.find((r) => r.value === track.rights)?.label}</Status></span>
        <Menu label={`More for ${track.title}`}>
          <MenuSub label="Rights">
            <MenuChoices value={track.rights} options={RIGHTS} onChange={(rights) => run(setRights({ payload: { id: track.id, rights }, reactivityKeys: ["music"] }))} />
          </MenuSub>
          <MenuSub label="Type">
            <MenuChoices value={track.kind} options={KINDS} onChange={(kind) => run(setKind({ payload: { id: track.id, kind }, reactivityKeys: ["music"] }))} />
          </MenuSub>
          <MenuSeparator />
          <MenuItem tone="danger" onClick={() => setConfirming(true)}><Trash2 />Remove</MenuItem>
        </Menu>
      </div>
      {problem === null ? null : <div className="px-3 pb-2 text-xs text-danger">{problem}</div>}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove “${track.title}”?`}
        description={usedBy.length === 0
          ? "It’s taken out of your library and its file is deleted."
          : `It’s taken out of your library and its file is deleted. ${plural(usedBy.length, "short")} use${usedBy.length === 1 ? "s" : ""} it.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false)
                run(remove({ payload: { id: track.id }, reactivityKeys: ["music"] }))
              }}
            >
              Remove
            </Button>
          </>
        }
      />
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

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
