import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { MAX_SHORT_SOURCES, MIN_SET_SOURCES, type SourceId, type SourceOrigin, type SourceRights } from "@viral/contracts"
import { useNavigate } from "@tanstack/react-router"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Panel } from "@viral/ui/primitives/panel"
import { Textarea } from "@viral/ui/primitives/textarea"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { cn } from "@viral/ui/cn"
import { ArrowDown, ArrowUp, Check, FolderOpen, GripVertical, Plus, X } from "lucide-react"
import { useState } from "react"
import { desktop } from "../../config/server-url.ts"
import { clock } from "../../lib/format.ts"
import { overviewAtom } from "../home/overview.ts"
import { createSource } from "../videos/videos-api.ts"
import { isVideoLink, RIGHTS_CHOICES } from "../videos/video-values.ts"
import { reorder } from "./set-values.ts"
import { createVideoSet, startSetRun } from "./sets-api.ts"
import { VideoDot } from "./video-badge.tsx"

// A video in the set being made: one from your library, or a link or file added here (made into a video on Start).
type Pick =
  | { readonly _tag: "Library"; readonly id: SourceId; readonly title: string; readonly sub: string | null }
  | { readonly _tag: "New"; readonly key: string; readonly origin: SourceOrigin; readonly title: string }

const keyOf = (pick: Pick) => pick._tag === "Library" ? pick.id : pick.key
const fileName = (path: string) => path.split("/").at(-1) ?? path

export const BRIEF_PLACEHOLDER =
  "e.g. Compare how each creator tried to make the same candy, and who actually got it right. Keep it about the build, not the sponsors."

// Several videos into one set: pick 2–10 from your library or add links and files, put them in order (the first video leads),
// and say what their shorts should achieve. Start reads each video, proposes shorts across them, and opens the set.
export function NewSetForm() {
  const navigate = useNavigate()
  const home = Option.getOrNull(AsyncResult.value(useAtomValue(overviewAtom)))
  const create = useAtomSet(createSource, { mode: "promise" })
  const createSet = useAtomSet(createVideoSet, { mode: "promise" })
  const startRun = useAtomSet(startSetRun, { mode: "promise" })
  const [picks, setPicks] = useState<ReadonlyArray<Pick>>([])
  const [input, setInput] = useState("")
  const [brief, setBrief] = useState("")
  const [rights, setRights] = useState<SourceRights>("unconfirmed")
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // the video being dragged to another place (its current index); the arrows do the same from the keyboard
  const [dragging, setDragging] = useState<number | null>(null)

  const full = picks.length >= MAX_SHORT_SOURCES
  const value = input.trim()
  const addable = !full && value !== "" && (isVideoLink(value) || value.startsWith("/"))
  const hasNew = picks.some((p) => p._tag === "New")
  const ready = picks.length >= MIN_SET_SOURCES && brief.trim() !== "" && !starting
  const library = home?.videos ?? []

  const add = (pick: Pick) => setPicks((all) => all.some((p) => keyOf(p) === keyOf(pick)) || all.length >= MAX_SHORT_SOURCES ? all : [...all, pick])
  const addInput = (text: string) => {
    const link = isVideoLink(text)
    add({ _tag: "New", key: text, origin: link ? { _tag: "Url", url: text } : { _tag: "File", path: text }, title: link ? text : fileName(text) })
    setInput("")
  }
  const remove = (key: string) => setPicks((all) => all.filter((p) => keyOf(p) !== key))
  const move = (i: number, by: number) =>
    setPicks((all) => {
      const j = i + by
      if (j < 0 || j >= all.length) return all
      const next = [...all]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  const chooseFiles = () => {
    void desktop?.openFiles("video").then((paths) => paths.forEach(addInput))
  }

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      const ids: Array<SourceId> = []
      for (const pick of picks) {
        if (pick._tag === "Library") ids.push(pick.id)
        else ids.push((await create({ payload: { origin: pick.origin, rights, rightsNote: null } })).id)
      }
      const set = await createSet({ payload: { sourceIds: ids, brief: brief.trim() } })
      await startRun({ payload: { setId: set.id } })
      await navigate({ to: "/sets/$setId", params: { setId: set.id } })
    } catch {
      setError("Couldn't start the set. Is the server running?")
    } finally {
      setStarting(false)
    }
  }

  const missing = picks.length < MIN_SET_SOURCES
    ? `Pick ${MIN_SET_SOURCES - picks.length} more ${MIN_SET_SOURCES - picks.length === 1 ? "video" : "videos"}`
    : brief.trim() === "" ? "Add what the shorts should achieve" : null

  return (
    <div className="grid gap-2">
      <Panel title="Videos" count={`${picks.length} of ${MAX_SHORT_SOURCES}`} actions={picks.length > 1 ? "Drag them into the order you'd tell it in" : undefined}>
        {picks.length === 0
          ? <div className="rounded-ctl bg-item px-3 py-3 text-xs text-fg-2">Pick at least two from your library below, or add links and files.</div>
          : picks.map((pick, i) => (
            <div
              key={keyOf(pick)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move"
                e.dataTransfer.setData("text/plain", keyOf(pick))
                setDragging(i)
              }}
              onDragOver={(e) => {
                if (dragging === null) return
                e.preventDefault()
                if (dragging !== i) {
                  setPicks((all) => reorder(all, dragging, i))
                  setDragging(i)
                }
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={() => setDragging(null)}
              className={cn(
                "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-ctl bg-item py-2 pr-3 pl-1.5",
                dragging === i && "opacity-60 shadow-[inset_0_0_0_1px_var(--lemon)]"
              )}
            >
              <GripVertical aria-hidden className="size-4 cursor-grab text-fg-3 active:cursor-grabbing" />
              <VideoDot index={i} className="size-2.5" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{pick.title}</span>
                <span className="block truncate text-xs text-fg-2">
                  {pick._tag === "Library" ? pick.sub ?? "In your library" : pick.origin._tag === "Url" ? "A link: read when you start" : "A file: copied in when you start"}
                </span>
              </span>
              <span className="flex items-center gap-0.5">
                <IconButton label="Earlier" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></IconButton>
                <IconButton label="Later" disabled={i === picks.length - 1} onClick={() => move(i, 1)}><ArrowDown /></IconButton>
                <IconButton label="Remove" onClick={() => remove(keyOf(pick))}><X /></IconButton>
              </span>
            </div>
          ))}
        <div className="mt-1.5 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addable && addInput(value)}
            placeholder={desktop === undefined ? "Add a link, or the full path of a video file" : "Add a link"}
            aria-label="Add a video link or file"
            className="flex-1"
            disabled={full}
          />
          {desktop === undefined ? null : <Button disabled={full} onClick={chooseFiles}><FolderOpen />Choose files</Button>}
          <Button disabled={!addable} onClick={() => addInput(value)}><Plus />Add</Button>
        </div>
      </Panel>

      {library.length === 0 ? null : (
        <Panel title="From your library" count={library.length}>
          <div className="grid max-h-[264px] grid-cols-2 gap-[3px] overflow-auto">
            {library.map(({ source, thumb }) => {
              const picked = picks.some((p) => p._tag === "Library" && p.id === source.id)
              const title = source.title ?? "Untitled video"
              const sub = [source.channel, source.durationS === null ? null : clock(source.durationS)].filter((p) => p !== null).join(" · ")
              return (
                <button
                  key={source.id}
                  type="button"
                  disabled={!picked && full}
                  onClick={() => picked ? remove(source.id) : add({ _tag: "Library", id: source.id, title, sub: sub === "" ? null : sub })}
                  className={`grid cursor-pointer grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-ctl bg-item px-2 py-1.5 text-left hover:bg-item-hover disabled:cursor-not-allowed disabled:opacity-45 ${picked ? "shadow-[inset_0_0_0_1px_var(--lemon)]" : ""}`}
                >
                  {thumb === null ? <span className="aspect-video w-12 rounded-[4px] bg-ctl-active" /> : <img src={thumb} alt="" className="aspect-video w-12 rounded-[4px] object-cover" loading="lazy" />}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{title}</span>
                    <span className="block truncate text-xs text-fg-2">{sub === "" ? "Not read yet" : sub}</span>
                  </span>
                  {picked ? <Check className="size-4 text-lemon-fg" /> : <Plus className="size-4 text-fg-3" />}
                </button>
              )
            })}
          </div>
        </Panel>
      )}

      <Panel title="What should these shorts achieve?">
        <p className="m-0 mb-2 text-xs text-fg-2">Required for several videos: it's how Viral knows why they belong together. Every step reads it first.</p>
        <Textarea
          aria-label="What should these shorts achieve?"
          placeholder={BRIEF_PLACEHOLDER}
          value={brief}
          maxLength={600}
          onChange={(e) => setBrief(e.currentTarget.value)}
        />
      </Panel>

      {hasNew ? (
        <Panel title="Who owns the footage you added?">
          <p className="m-0 mb-2 text-xs text-fg-2">For the links and files added here. Videos from your library keep their own.</p>
          {RIGHTS_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() => setRights(choice.value)}
              className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-ctl bg-item px-3 py-2 text-left hover:bg-item-hover ${rights === choice.value ? "shadow-[inset_0_0_0_1px_var(--lemon)]" : ""}`}
            >
              <span>
                <span className="block font-medium">{choice.title}</span>
                <span className="block text-xs text-fg-2">{choice.sub}</span>
              </span>
              {rights === choice.value ? <Check className="size-4 text-lemon-fg" /> : null}
            </button>
          ))}
        </Panel>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-1">
        {error !== null ? <span className="text-xs text-danger">{error}</span> : missing === null ? null : <span className="text-xs text-fg-2">{missing}</span>}
        <Button variant="primary" size="md" disabled={!ready} onClick={() => void start()}>{starting ? "Starting…" : "Start"}</Button>
      </div>
    </div>
  )
}
