import { useAtomSet } from "@effect/atom-react"
import type { GateResponse, Research, RunRequest, Shortlist, ShortlistVideo, SourceSetId } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Input } from "@viral/ui/primitives/input"
import { Menu, MenuItem } from "@viral/ui/primitives/menu"
import { Panel } from "@viral/ui/primitives/panel"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { Textarea } from "@viral/ui/primitives/textarea"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, ExternalLink, Plus, RefreshCw, RotateCcw, Shuffle, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { serverUrl } from "../../config/server-url.ts"
import { homeFileUrl } from "../../lib/media-url.ts"
import { VideoDot } from "../sets/video-badge.tsx"
import { respondToRequest } from "../shorts/shorts-api.ts"
import { Detail, useDetailed } from "../system/detail.tsx"
import { checkShortlistEdit, lookupShortlistVideo } from "./research-api.ts"
import {
  addPick,
  askForAnother,
  BACKUPS_NOTE,
  changed,
  COPYRIGHT_FULL,
  downloadLabel,
  isOnList,
  momentChips,
  movePick,
  newListNote,
  removeBackup,
  removePick,
  useBackup,
  videoFacts
} from "./research-values.ts"

// While the research searches: what it's doing right now and a grey row for each video it will find (never a
// spinner).
export function ShortlistSearching({ research, message }: { readonly research: Research; readonly message: string | null }) {
  return (
    <>
      <Panel title="The idea">
        <p className="m-0 leading-relaxed text-fg-1">{research.idea}</p>
      </Panel>
      <Panel title="Shortlist" count={`${research.videos} videos`} actions="Nothing downloads until you approve">
        <div className="mb-1 truncate text-xs text-fg-2">{message ?? "Searching YouTube…"}</div>
        <SkeletonRegion label="Searching YouTube" className="flex flex-col gap-[3px]">
          {Array.from({ length: research.videos }, (_, i) => (
            <div key={i} className="grid grid-cols-[auto_96px_minmax(0,1fr)] items-center gap-3 rounded-ctl bg-item px-3 py-2">
              <VideoDot index={i} className="size-2.5 opacity-40" />
              <Skeleton className="aspect-video w-24 rounded-[5px]" />
              <div className="grid gap-1.5">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3" style={{ width: `${70 - (i % 3) * 12}%` }} />
                <Skeleton className="h-2.5 w-52" />
              </div>
            </div>
          ))}
        </SkeletonRegion>
      </Panel>
    </>
  )
}

// The shortlist gate: the agent's list, which you can change (remove, reorder, swap in a backup, ask for another,
// add a link) before downloading. Your changes are checked first; a note to the agent asks for a new list.
export function ShortlistGate({ setId, research, request, shortlist, onAnswered }: {
  readonly setId: SourceSetId
  readonly research: Research
  readonly request: RunRequest
  readonly shortlist: Shortlist
  readonly onAnswered: () => void
}) {
  const respond = useAtomSet(respondToRequest, { mode: "promise" })
  const check = useAtomSet(checkShortlistEdit, { mode: "promise" })
  const lookup = useAtomSet(lookupShortlistVideo, { mode: "promise" })
  const detailed = useDetailed()
  const [edited, setEdited] = useState(shortlist)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<ReadonlyArray<string>>([])
  const [link, setLink] = useState("")
  const [looking, setLooking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [askingNew, setAskingNew] = useState(false)
  useEffect(() => {
    setEdited(shortlist)
    setProblems([])
  }, [request.id, shortlist])

  const isChanged = changed(shortlist, edited)
  const answer = (response: GateResponse) => {
    setBusy(true)
    setProblems([])
    return respond({ payload: { requestId: request.id, response } })
      .then(onAnswered)
      .catch(() => setProblems(["Couldn't send that. Is the server running?"]))
      .finally(() => setBusy(false))
  }
  const download = () => {
    if (!isChanged) return void answer({ _tag: "Approve" })
    setBusy(true)
    check({ payload: { setId, shortlist: edited } })
      .then((result) => {
        if (result.problems.length > 0) {
          setProblems(result.problems)
          setBusy(false)
          return
        }
        return answer({ _tag: "Edit", artifact: edited })
      })
      .catch(() => {
        setProblems(["Couldn't check the list. Is the server running?"])
        setBusy(false)
      })
  }
  const another = (i: number) => {
    const next = askForAnother(shortlist, edited, i)
    if (next._tag === "Backup") setEdited(next.list)
    else void answer({ _tag: "Reject", note: next.note })
  }
  const addLink = () => {
    setLooking(true)
    setLinkError(null)
    lookup({ payload: { setId, link: link.trim() } })
      .then((video) => {
        if (isOnList(edited, video.videoId)) setLinkError("That video is already on the list.")
        else {
          setEdited((list) => addPick(list, video))
          setLink("")
        }
      })
      .catch((error: unknown) =>
        setLinkError(typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "Couldn't look that link up.")
      )
      .finally(() => setLooking(false))
  }

  return (
    <>
      <Panel title="The idea">
        <p className="m-0 leading-relaxed text-fg-1">{research.idea}</p>
        {edited.summary === "" ? null : <p className="m-0 mt-1 text-xs text-fg-2">{edited.summary}</p>}
        <Detail>
          {edited.searches.length === 0 ? null : (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="mr-1 text-xs text-fg-2">{edited.searches.length} searches:</span>
              {edited.searches.map((q, i) => <span key={i} className="rounded-chip bg-item px-2 py-0.5 text-xs text-fg-1">{q}</span>)}
            </div>
          )}
        </Detail>
      </Panel>

      <Panel
        title="Shortlist"
        count={`${edited.picks.length} ${edited.picks.length === 1 ? "video" : "videos"}`}
        actions={
          <>
            {isChanged ? <Button variant="ghost" disabled={busy} onClick={() => (setEdited(shortlist), setProblems([]))}><RotateCcw />Undo changes</Button> : null}
            <Button variant="ghost" disabled={busy} onClick={() => setAskingNew(true)}><RefreshCw />Ask for a new list</Button>
          </>
        }
      >
        {edited.picks.map((video, i) => (
          <VideoRow key={video.videoId} video={video} index={i} detailed={detailed}>
            <IconButton label="Remove" disabled={busy} onClick={() => setEdited((list) => removePick(list, i))}><X /></IconButton>
            <Menu label={`More for ${video.title}`}>
              <MenuItem disabled={busy} onClick={() => another(i)}>
                <Shuffle />{edited.backups.length > 0 ? `Use the backup: ${edited.backups[0]!.title.slice(0, 32)}` : "Ask for another"}
              </MenuItem>
              <MenuItem disabled={i === 0} onClick={() => setEdited((list) => movePick(list, i, -1))}><ArrowUp />Earlier</MenuItem>
              <MenuItem disabled={i === edited.picks.length - 1} onClick={() => setEdited((list) => movePick(list, i, 1))}><ArrowDown />Later</MenuItem>
              <MenuItem onClick={() => window.open(video.url, "_blank", "noreferrer")}><ExternalLink />Open on YouTube</MenuItem>
            </Menu>
          </VideoRow>
        ))}
        <div className="mt-1.5 flex gap-2">
          <Input
            value={link}
            onChange={(e) => (setLink(e.target.value), setLinkError(null))}
            onKeyDown={(e) => e.key === "Enter" && link.trim() !== "" && !looking && addLink()}
            placeholder="Add a YouTube link"
            aria-label="Add a YouTube link"
            className="flex-1"
          />
          <Button disabled={link.trim() === "" || looking} onClick={addLink}><Plus />{looking ? "Looking it up…" : "Add"}</Button>
        </div>
        {linkError === null ? null : <div className="text-xs text-danger">{linkError}</div>}
      </Panel>

      {edited.backups.length === 0 ? null : (
        <Panel title={<span className="text-fg-1">Backups</span>} count={edited.backups.length} actions={BACKUPS_NOTE} className="bg-transparent shadow-[inset_0_0_0_1px_var(--line)]">
          {edited.backups.map((video, b) => (
            <VideoRow key={video.videoId} video={video} index={null} detailed={detailed} quiet>
              <Menu label={`Use ${video.title} instead of…`} trigger={<>Use instead of…</>}>
                {edited.picks.map((pick, i) => (
                  <MenuItem key={pick.videoId} onClick={() => setEdited((list) => useBackup(list, b, i))}>
                    <VideoDot index={i} />{pick.title.slice(0, 40)}
                  </MenuItem>
                ))}
              </Menu>
              <IconButton label="Remove backup" disabled={busy} onClick={() => setEdited((list) => removeBackup(list, b))}><X /></IconButton>
            </VideoRow>
          ))}
        </Panel>
      )}

      <p className="m-0 px-1 text-xs leading-relaxed text-fg-2">{COPYRIGHT_FULL}</p>

      <div className="flex items-start justify-end gap-3 pt-1">
        {problems.length === 0
          ? <span className="mr-auto text-xs text-fg-2">{isChanged ? "You changed the list: Viral checks it before downloading." : "Each video downloads at up to 1080p, then Viral reads it."}</span>
          : <ul className="m-0 mr-auto grid gap-0.5 pl-4 text-xs text-danger">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        <Button variant="primary" size="md" disabled={busy || edited.picks.length === 0} onClick={download}><Download />{downloadLabel(edited.picks.length)}</Button>
      </div>

      <AskNewList
        open={askingNew}
        busy={busy}
        onCancel={() => setAskingNew(false)}
        onSend={(words) => {
          setAskingNew(false)
          void answer({ _tag: "Reject", note: newListNote(shortlist, edited, words) })
        }}
      />
    </>
  )
}

// One video on the list: its colour dot (none for a backup), thumbnail, part, title, facts and why; the moments it
// expects in Detailed view. `children` are its actions.
function VideoRow({ video, index, detailed, quiet, children }: {
  readonly video: ShortlistVideo
  readonly index: number | null
  readonly detailed: boolean
  readonly quiet?: boolean
  readonly children: ReactNode
}) {
  const moments = momentChips(video)
  return (
    <div className={`grid grid-cols-[auto_96px_minmax(0,1fr)_auto] items-center gap-3 rounded-ctl px-3 py-2 ${quiet === true ? "bg-transparent" : "bg-item"}`}>
      {index === null ? <span className="size-2.5" /> : <VideoDot index={index} className="size-2.5" />}
      {video.thumbnail === null
        ? <span className="aspect-video w-24 rounded-[5px] bg-ctl-active" />
        : <img src={homeFileUrl(serverUrl, video.thumbnail)} alt="" className={`aspect-video w-24 rounded-[5px] object-cover ${quiet === true ? "opacity-80" : ""}`} loading="lazy" />}
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-fg-2">{video.part}</div>
        <div className={`truncate font-medium ${quiet === true ? "text-fg-1" : ""}`}>{video.title}</div>
        <div className="truncate text-xs text-fg-2">{videoFacts(video, detailed)}</div>
        <div className="mt-0.5 line-clamp-2 text-xs text-fg-1">{video.why}</div>
        {detailed && moments.length > 0 ? <ExpectedMoments moments={moments} /> : null}
      </div>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  )
}

// The moments the agent expects, as short chips ("before ~0:12"), each with its full words on hover; the toggle
// opens them as lines. Detailed view only.
function ExpectedMoments({ moments }: { readonly moments: ReturnType<typeof momentChips> }) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={(e) => (e.stopPropagation(), setOpen(!open))}
          className="mr-0.5 inline-flex items-center gap-0.5 rounded-chip text-xs text-fg-2 hover:text-fg-1"
        >
          <Chevron className="size-3" />
          Expects (a guess)
        </button>
        {moments.map((m, i) => (
          <span key={i} title={m.full} className="rounded-chip bg-ctl-active px-1.5 py-px text-[11px] text-fg-1">
            {m.tag}
            {m.at === null ? null : <span className="ml-1 text-fg-2 tabular-nums">{m.at}</span>}
          </span>
        ))}
      </div>
      {open
        ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-fg-2">
            {moments.map((m, i) => (
              <li key={i}>
                {m.at === null ? null : <span className="mr-1.5 text-fg-1 tabular-nums">{m.at}</span>}
                {m.full}
              </li>
            ))}
          </ul>
        )
        : null}
    </div>
  )
}

function AskNewList({ open, busy, onCancel, onSend }: {
  readonly open: boolean
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSend: (words: string) => void
}) {
  const [words, setWords] = useState("")
  useEffect(() => {
    if (open) setWords("")
  }, [open])
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title="Ask for a new list"
      description="Say what to change. The agent carries on from its searches, and its new list comes back here."
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={busy || words.trim() === ""} onClick={() => onSend(words)}>Send</Button>
        </>
      }
    >
      <Textarea
        aria-label="What to change"
        placeholder="e.g. More variety: no two dogs, and add a horse or a donkey."
        value={words}
        onChange={(e) => setWords(e.currentTarget.value)}
      />
    </Dialog>
  )
}

