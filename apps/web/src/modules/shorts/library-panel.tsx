import { useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { MAX_SHORT_SOURCES, type Rights, type Voice } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Menu, MenuChoices } from "@viral/ui/primitives/menu"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { AudioLines, Mic, Music, Pause, Play, Plus, Search, X } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { overviewAtom } from "../home/overview.ts"
import { exploreVoicesAtom } from "../library/library-api.ts"
import { voiceLine } from "../library/voices/voices-values.ts"
import { VideoDot } from "../sets/video-badge.tsx"
import { AddVideoDialog } from "./add-video-dialog.tsx"
import {
  clock,
  filterItems,
  type LibraryFilter,
  type LibraryItem,
  type LibraryTab,
  type LibraryType,
  NO_FILTER,
  RIGHTS_NAMES,
  typesOf,
  usesLine
} from "./library-panel-values.ts"
import { Panel, PanelBody } from "./panel.tsx"
import { ROLE_NAMES } from "./ranking/ranking-values.ts"
import { nameOf, useShortVideos } from "./short-videos.tsx"
import { selectedShot, ShotDetail } from "./shots/shots-step.tsx"
import type { EditorState } from "./use-editor-state.ts"

type Item = LibraryItem & { readonly open: (() => void) | null }

// This short's own things: its videos (what it takes from each), its frames (shots, sections or a ranking's
// moments), its real lines, its song and its voice. A frame opens its step at that shot, section or entry.
function shortItems(e: EditorState, names: ReturnType<typeof useShortVideos>, thumbOf: (id: string) => string | null, toVideo: (id: string) => void): ReadonlyArray<Item> {
  const { ws } = e
  const items: Array<Item> = []
  const plan = ws.shotPlan?.plan ?? null
  const reals = ws.script?.script.beats.flatMap((b) => (b._tag === "Real" ? [b] : [])) ?? []
  ws.videos.forEach((v, i) => {
    const uses = ws.project.format === "cut-down"
      ? usesLine(e.planDraft?.sections.filter((s) => (s.source ?? 0) === i).length ?? 0, 0, "section")
      : ws.project.format === "ranking"
      ? usesLine(e.rankingPlanDraft?.entries.filter((x) => (x.source ?? 0) === i).reduce((n, x) => n + x.shots.length, 0) ?? 0, 0, "moment")
      : usesLine(plan?.shots.filter((s) => (s.source ?? 0) === i).length ?? 0, reals.filter((r) => (r.source ?? 0) === i).length)
    items.push({
      key: `video-${v.source.id}`,
      type: "Videos",
      name: nameOf(names, i),
      sub: uses,
      picture: thumbOf(v.source.id),
      badge: v.seconds > 0 ? clock(v.seconds) : null,
      video: i,
      used: true,
      rights: v.source.rights,
      open: () => toVideo(v.source.id)
    })
  })
  const several = ws.videos.length > 1
  const where = (source: number, t: number) => `${several ? `${nameOf(names, source)} · ` : ""}${clock(t)}`
  plan?.shots.forEach((s, k) => {
    const change = e.draft.get(k)
    const source = change?.source ?? s.source ?? 0
    items.push({
      key: `shot-${k}`,
      type: "Frames",
      name: `Shot ${k + 1}`,
      sub: where(source, change?.src ?? s.src),
      picture: e.shotFrame(k),
      badge: null,
      video: source,
      used: true,
      rights: null,
      open: () => {
        e.selectShot(k)
        e.setShotDetail(true)
        if (e.open !== "shots") e.onStep("shots")
      }
    })
  })
  e.planDraft?.sections.forEach((s, k) => {
    items.push({
      key: `section-${k}`,
      type: "Frames",
      name: `Section ${k + 1}`,
      sub: where(s.source ?? 0, s.start),
      picture: e.stillOf(e.planDraft)(k),
      badge: `${(s.end - s.start).toFixed(1)}s`,
      video: s.source ?? 0,
      used: true,
      rights: null,
      open: () => {
        e.setSectionK(k)
        e.setSectionPlaying(false)
        if (e.open !== "sections") e.onStep("sections")
      }
    })
  })
  e.rankingPlanDraft?.entries.slice().sort((a, b) => a.rank - b.rank).forEach((entry) =>
    entry.shots.forEach((s, k) =>
      items.push({
        key: `rank-${entry.rank}-${k}`,
        type: "Frames",
        name: `#${entry.rank} · ${ROLE_NAMES[s.role]}`,
        sub: where(entry.source ?? 0, s.start),
        picture: e.rankingStillOf(entry.rank, k),
        badge: `${(s.end - s.start).toFixed(1)}s`,
        video: entry.source ?? 0,
        used: true,
        rights: null,
        open: () => {
          e.setRankingRank(entry.rank)
          if (e.open !== "moments") e.onStep("moments")
        }
      })
    )
  )
  const clips = plan === null
    ? reals.map((r, i) => ({ key: `real-${i}`, quote: r.quote, source: r.source ?? 0, start: r.start, end: r.end, frame: null as string | null }))
    : [
      ...plan.inserts.map((c, i) => ({ key: `insert-${i}`, quote: c.quote, source: c.source ?? 0, start: c.start, end: c.end, frame: e.realFrame("insert", i) })),
      ...plan.outro.map((c, i) => ({ key: `outro-${i}`, quote: c.quote, source: c.source ?? 0, start: c.start, end: c.end, frame: e.realFrame("outro", i) }))
    ]
  for (const c of clips) {
    items.push({ key: c.key, type: "Clips", name: `“${c.quote}”`, sub: where(c.source, c.start), picture: c.frame, badge: `${(c.end - c.start).toFixed(1)}s`, video: c.source, used: true, rights: null, open: null })
  }
  const track = e.tracks.find((t) => t.id === ws.project.musicTrackId) ?? null
  if (track !== null && ws.project.format === "narrated") {
    const drop = e.fitted?.bed.dropWordText ?? null
    items.push({
      key: `track-${track.id}`,
      type: "Music",
      name: track.title,
      sub: drop === null ? (track.bpm === null ? "Song" : `${track.bpm.toFixed(1)} BPM`) : `drop on “${drop}”`,
      picture: null,
      badge: track.durationS === null ? null : clock(track.durationS),
      video: null,
      used: true,
      rights: track.rights,
      open: () => e.setPanel("music")
    })
  }
  if (ws.voiceover !== null) {
    items.push({
      key: "voiceover",
      type: "Voice",
      name: `${e.voiceName} · the take`,
      sub: `${ws.voiceover.voiceover.pace.toFixed(1)} words a second`,
      picture: null,
      badge: `${ws.voiceover.voiceover.durationS.toFixed(1)}s`,
      video: null,
      used: true,
      rights: null,
      open: () => e.setPanel("voice")
    })
  }
  return items
}

// Everything in your library: your videos, songs and voices, marked when this short uses them.
function libraryItems(e: EditorState, videos: ReadonlyArray<{ readonly source: { readonly id: string; readonly title: string | null; readonly channel: string | null; readonly durationS: number | null; readonly rights: Rights }; readonly thumb: string | null }>, voices: ReadonlyArray<Voice>, toVideo: (id: string) => void): ReadonlyArray<Item> {
  const { ws } = e
  const narrated = ws.project.format === "narrated"
  return [
    ...videos.map((v): Item => {
      const position = ws.project.sourceIds.findIndex((id) => id === v.source.id)
      return {
        key: `lib-video-${v.source.id}`,
        type: "Videos",
        name: v.source.title ?? "Untitled video",
        sub: v.source.channel ?? (position === -1 ? "Not in this short" : "In this short"),
        picture: v.thumb,
        badge: v.source.durationS === null ? null : clock(v.source.durationS),
        video: position === -1 ? null : position,
        used: position !== -1,
        rights: v.source.rights,
        open: () => toVideo(v.source.id)
      }
    }),
    ...e.tracks.map((t): Item => ({
      key: `lib-track-${t.id}`,
      type: "Music",
      name: t.title,
      sub: `${t.bpm === null ? "Tempo not known yet" : `${t.bpm.toFixed(1)} BPM`} · ${RIGHTS_NAMES[t.rights]}`,
      picture: null,
      badge: t.durationS === null ? null : clock(t.durationS),
      video: null,
      used: t.id === ws.project.musicTrackId,
      rights: t.rights,
      open: narrated
        ? () => {
          e.setPanel("music")
          e.setPickingSong(true)
        }
        : null
    })),
    ...voices.map((v): Item => ({
      key: `lib-voice-${v.voiceId}`,
      type: "Voice",
      name: v.name.split(" - ")[0] ?? v.name,
      sub: voiceLine(v),
      picture: null,
      badge: null,
      video: null,
      used: narrated && v.voiceId === ws.voiceId,
      rights: null,
      open: narrated ? () => e.setPanel("voice") : null
    }))
  ]
}

// One tile of the grid: its picture (a frame, or a waveform mark for sound) with a small count, its video's colour dot
// and name, and the line under it. A tile that leads somewhere is a button.
function Tile({ item }: { readonly item: Item }) {
  const sound = item.type === "Music" || item.type === "Voice"
  const body = (
    <>
      <span className="relative block aspect-[16/10] overflow-hidden rounded-[9px] bg-ctl-active">
        {item.picture !== null
          ? <img src={item.picture} alt="" className="size-full object-cover" loading="lazy" />
          : sound
          ? <span className="grid size-full place-items-center text-fg-3">{item.type === "Music" ? <Music className="size-5" /> : <AudioLines className="size-5" />}</span>
          : <Skeleton className="size-full rounded-none" />}
        {item.badge === null ? null : (
          <span className="absolute right-1.5 bottom-1.5 inline-flex h-5 items-center rounded-[6px] bg-black/60 px-1.5 text-[11px] text-white tabular-nums">{item.badge}</span>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
        {item.video === null ? null : <VideoDot index={item.video} />}
        <span className="truncate">{item.name}</span>
      </span>
      <span className="-mt-0.5 truncate text-[11.5px] text-fg-2">{item.sub}</span>
    </>
  )
  return item.open === null
    ? <div className="grid min-w-0 content-start gap-[5px]">{body}</div>
    : (
      <button type="button" onClick={item.open} className="grid min-w-0 content-start gap-[5px] rounded-[10px] text-left outline-none hover:[&>span:first-child]:shadow-[0_0_0_1px_var(--line-2)] focus-visible:[&>span:first-child]:shadow-[0_0_0_1px_var(--lemon)]">
        {body}
      </button>
    )
}

// A filter chip: "+ Video" until one is chosen, then the choice with × to clear it.
function FilterChip<V extends string>({ label, value, options, onChange }: {
  readonly label: string
  readonly value: V | null
  readonly options: ReadonlyArray<{ readonly value: V; readonly label: ReactNode }>
  readonly onChange: (value: V | null) => void
}) {
  if (value !== null) {
    return (
      <span className="inline-flex h-[26px] items-center gap-1 rounded-[7px] bg-sel pr-1 pl-2 text-xs text-fg shadow-[inset_0_0_0_1px_var(--line-2)]">
        {options.find((o) => o.value === value)?.label}
        <button type="button" aria-label={`Clear ${label}`} onClick={() => onChange(null)} className="grid size-4 place-items-center rounded-[4px] text-fg-2 hover:text-fg"><X className="size-3" /></button>
      </span>
    )
  }
  return (
    <Menu label={`Only one ${label.toLowerCase()}`} align="start" triggerClassName="h-[26px] gap-1 rounded-[7px] px-2 font-normal text-fg-1 shadow-[inset_0_0_0_1px_var(--line-2)]" trigger={<><Plus />{label}</>}>
      <MenuChoices<V | "any"> value="any" onChange={(v) => onChange(v === "any" ? null : v)} options={options} />
    </Menu>
  )
}

// Shared ElevenLabs voices to listen to (their samples are free); adding one is Library › Voices'.
function ExploreList() {
  const navigate = useNavigate()
  const query = { search: null, language: "en", useCase: "narrative_story" as const, gender: null, age: null, sort: "trending" as const, page: 0 }
  const result = useAtomValue(exploreVoicesAtom(JSON.stringify(query)))
  const sample = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => sample.current?.pause(), [])
  const data = Option.getOrNull(AsyncResult.value(result))
  const play = (id: string, url: string) => {
    sample.current?.pause()
    if (playing === id) return setPlaying(null)
    const el = new Audio(url)
    el.onended = () => setPlaying(null)
    sample.current = el
    setPlaying(id)
    void el.play().catch(() => setPlaying(null))
  }
  return (
    <>
      <span className="text-xs text-fg-2">Shared voices for narration on ElevenLabs. Samples are free; add one from Library › Voices.</span>
      {data === null ? (
        AsyncResult.isFailure(result)
          ? <span className="text-sm text-fg-2">Couldn’t reach ElevenLabs’ voice library. Check your key in Settings › Accounts.</span>
          : <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11" />)}</div>
      ) : (
        <div className="grid gap-px">
          {data.voices.slice(0, 12).map((v) => (
            <div key={v.voiceId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-ctl px-2 py-1.5 hover:bg-ctl">
              <span className="grid min-w-0">
                <span className="truncate text-sm">{v.name}</span>
                <span className="truncate text-xs text-fg-2">{v.description ?? [v.accent, v.gender, v.age].filter((x) => x !== null).join(" · ")}</span>
              </span>
              <IconButton label={playing === v.voiceId ? "Stop" : `Play ${v.name}'s sample`} disabled={v.previewUrl === null} onClick={() => v.previewUrl !== null && play(v.voiceId, v.previewUrl)}>
                {playing === v.voiceId ? <Pause /> : <Play />}
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <Button className="justify-self-start" onClick={() => void navigate({ to: "/library/voices" })}><Mic />Open Library › Voices</Button>
    </>
  )
}

// The Library panel: this short's videos, frames, real lines, song and voice; your whole library; and voices to
// explore. Type chips, a search and filters (+ Video, + Used, + Rights) narrow the grid. On the Shots step, a frame
// opens that shot: its frame picker, framing, crop and speed (Library › Shot n).
export function LibraryPanel({ e }: { readonly e: EditorState }) {
  const navigate = useNavigate()
  const names = useShortVideos()
  const overview = Option.getOrNull(AsyncResult.value(useAtomValue(overviewAtom)))
  const [filter, setFilter] = useState<Omit<LibraryFilter, "type">>(NO_FILTER)
  const [adding, setAdding] = useState(false)
  if (e.shotDetail && e.ws.shotPlan !== null) {
    return (
      <Panel title={`Shot ${selectedShot(e) + 1}`} back={{ label: "Library", onClick: () => e.setShotDetail(false) }}>
        <ShotDetail e={e} />
      </Panel>
    )
  }
  const toVideo = (id: string) => void navigate({ to: "/videos/$sourceId", params: { sourceId: id } })
  const thumbOf = (id: string) => overview?.videos.find((v) => v.source.id === id)?.thumb ?? null
  const all = e.libraryTab === "short" ? shortItems(e, names, thumbOf, toVideo) : e.libraryTab === "library" ? libraryItems(e, overview?.videos ?? [], e.voices, toVideo) : []
  const types = typesOf(all)
  const type: LibraryType = types.includes(e.libraryType) ? e.libraryType : "All"
  const shown = filterItems(all, { ...filter, type })
  const videoOptions = e.ws.videos.map((_, i) => ({ value: String(i), label: <span className="flex items-center gap-1.5"><VideoDot index={i} />{nameOf(names, i)}</span> }))
  return (
    <Panel
      title="Library"
      action={
        <Button disabled={e.ws.project.sourceIds.length >= MAX_SHORT_SOURCES} title="Add a video to this short: from your library, a link or a file" onClick={() => setAdding(true)}>
          <Plus />Video
        </Button>
      }
      under={
        <Segmented<LibraryTab>
          label="Library"
          full
          value={e.libraryTab}
          onChange={e.setLibraryTab}
          options={[{ value: "short", label: "This short" }, { value: "library", label: "Your library" }, { value: "explore", label: "Explore" }]}
        />
      }
    >
      <PanelBody>
        {e.libraryTab === "explore" ? <ExploreList /> : (
          <>
            <div role="tablist" aria-label="Kind" className="flex flex-wrap gap-1">
              {types.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={t === type}
                  onClick={() => e.setLibraryType(t)}
                  className={cn("h-[26px] rounded-[7px] px-2.5 text-xs text-fg-2 outline-none hover:bg-ctl hover:text-fg", t === type && "bg-sel font-medium text-fg shadow-[inset_0_0_0_1px_var(--line-2)]")}
                >
                  {t}
                </button>
              ))}
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" />
              <Input aria-label="Search the library" placeholder="Search…" className="h-8 w-full pl-8" value={filter.query} onChange={(x) => setFilter({ ...filter, query: x.currentTarget.value })} />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {e.ws.videos.length > 1 ? (
                <FilterChip<string> label="Video" value={filter.video === null ? null : String(filter.video)} options={videoOptions} onChange={(v) => setFilter({ ...filter, video: v === null ? null : Number(v) })} />
              ) : null}
              {e.libraryTab === "library" ? (
                <FilterChip<"yes" | "no">
                  label="Used"
                  value={filter.used === null ? null : filter.used ? "yes" : "no"}
                  options={[{ value: "yes", label: "Used in this short" }, { value: "no", label: "Not used yet" }]}
                  onChange={(v) => setFilter({ ...filter, used: v === null ? null : v === "yes" })}
                />
              ) : null}
              <FilterChip<Rights>
                label="Rights"
                value={filter.rights}
                options={(["owned", "licensed", "unconfirmed"] as const).map((r) => ({ value: r, label: RIGHTS_NAMES[r] }))}
                onChange={(rights) => setFilter({ ...filter, rights })}
              />
            </div>
            {shown.length === 0 ? (
              <span className="py-6 text-center text-sm text-fg-2">
                {type === "Frames" && e.libraryTab === "short" ? "No frames yet. They're picked once the run gets there." : "Nothing matches."}
              </span>
            ) : (
              <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">
                {shown.map((item) => <Tile key={item.key} item={item} />)}
              </div>
            )}
          </>
        )}
      </PanelBody>
      <AddVideoDialog project={e.ws.project} open={adding} onOpenChange={setAdding} running={e.going} onAdded={e.refresh} />
    </Panel>
  )
}
