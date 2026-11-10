import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { ProjectId, type RunId, SourceId, SourceSetId } from "@viral/contracts"
import { useNavigate } from "@tanstack/react-router"
import { cn } from "@viral/ui/cn"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { EmptyState } from "@viral/ui/primitives/empty-state"
import { Menu, MenuChoices, MenuItem, MenuNote, MenuSeparator } from "@viral/ui/primitives/menu"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Film, Inbox, LayoutGrid, List, Plus, Search, X } from "lucide-react"
import { type ReactNode, useState } from "react"
import { ago } from "../../lib/format.ts"
import { stepOfStage } from "../shorts/editor-values.ts"
import { deleteVideoSet } from "../sets/sets-api.ts"
import { recentsViewAtom } from "../system/preferences.ts"
import { deleteProject, deleteSource, runProgressAtom } from "../videos/videos-api.ts"
import { overviewAtom } from "./overview.ts"
import {
  filterRows,
  liveStage,
  RECENT_TABS,
  type RecentRow,
  type RecentTab,
  STATUS_FILTERS,
  type StatusFilter,
  statusChip,
  tabCounts
} from "./recents-values.ts"

// The row's status chip; a running row follows its run live ("Rendering · 62%").
function RowStatus({ row, compact, className }: { readonly row: RecentRow; readonly compact?: boolean; readonly className?: string }) {
  const running = row.runId !== null && (row.status._tag === "Running" || row.status._tag === "Reading")
  if (running) return <LiveStatus row={row} runId={row.runId!} compact={compact ?? false} className={className} />
  const chip = statusChip(row.status, null, compact)
  return <Status tone={chip.tone} className={cn("max-w-full truncate", className)}><StatusDot tone={chip.tone} />{chip.label}</Status>
}

function LiveStatus({ row, runId, compact, className }: { readonly row: RecentRow; readonly runId: RunId; readonly compact: boolean; readonly className?: string | undefined }) {
  const progress = Option.getOrNull(AsyncResult.value(useAtomValue(runProgressAtom(runId))))
  const chip = statusChip(row.status, progress === null ? null : liveStage(progress), compact)
  return <Status tone={chip.tone} className={cn("max-w-full truncate", className)}><StatusDot tone={chip.tone} />{chip.label}</Status>
}

const DOT = { neutral: null, ok: "bg-ok-dot", wait: "bg-wait-dot", run: "bg-run-dot" } as const
function StatusDot({ tone }: { readonly tone: keyof typeof DOT }) {
  const color = DOT[tone]
  return color === null ? null : <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", color)} />
}

// A short's picture is 9:16; a set's or a video's is its first video's frame (16:9).
function RowThumb({ row }: { readonly row: RecentRow }) {
  const src = row.thumbs[0] ?? null
  const wide = row.kind !== "short"
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-[5px] bg-ctl-active text-fg-3", wide ? "h-8 w-14" : "h-10 w-[26px]")}>
      {src === null ? <Film className="size-3.5" /> : <img src={src} alt="" className="size-full object-cover" loading="lazy" />}
    </span>
  )
}

// The grid's picture: the short's frame, or a mosaic of the set's videos.
function GridPicture({ row }: { readonly row: RecentRow }) {
  if (row.kind === "set" && row.thumbs.length > 1) {
    return (
      <span className="absolute inset-0 grid grid-cols-2 gap-0.5" style={{ gridTemplateRows: `repeat(${Math.ceil(Math.min(row.thumbs.length, 6) / 2)}, minmax(0, 1fr))` }}>
        {row.thumbs.slice(0, 6).map((src, i) => <img key={i} src={src} alt="" className="size-full object-cover" loading="lazy" />)}
      </span>
    )
  }
  const src = row.thumbs[0] ?? null
  return src === null
    ? <span className="absolute inset-0 grid place-items-center text-fg-3"><Film className="size-5" /></span>
    : <img src={src} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
}

const KIND_WORD = { short: "short", set: "video set", video: "video" } as const

// Home's recents: your shorts, video sets and single videos, newest first, with All / Shorts / Video sets, a status
// filter (Waiting for you is the sidebar's shortcut to it), search, and a list or a grid (kept per viewer).
export function Recents({ rows, status, onStatus }: {
  readonly rows: ReadonlyArray<RecentRow>
  readonly status: StatusFilter | null
  readonly onStatus: (status: StatusFilter | null) => void
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<RecentTab>("all")
  const [query, setQuery] = useState("")
  const [view, setView] = useAtom(recentsViewAtom)
  const [deleting, setDeleting] = useState<RecentRow | null>(null)
  const shown = filterRows(rows, { tab, status, query })
  const counts = tabCounts(rows, status)
  const now = Date.now()

  const open = (row: RecentRow) => {
    const target = row.target
    if (target._tag === "Short") {
      const step = target.stage === null ? undefined : stepOfStage(target.stage)
      void navigate({ to: "/shorts/$projectId", params: { projectId: target.projectId }, search: step === undefined ? {} : { step } })
    } else if (target._tag === "Set") void navigate({ to: "/sets/$setId", params: { setId: target.setId } })
    else void navigate({ to: "/videos/$sourceId", params: { sourceId: target.sourceId } })
  }

  const statusLabel = STATUS_FILTERS.find((f) => f.value === status)?.label
  const waitingEmpty = status === "waiting" && query.trim() === "" && tab === "all"
  const body = rows.length === 0
    ? <EmptyState icon={<Film />} title="Nothing made yet" sentence="Type an idea, paste a link or drop a video above. Your shorts and video sets show up here." />
    : shown.length === 0
    ? waitingEmpty
      ? <EmptyState icon={<Inbox />} title="Nothing is waiting" sentence="Shorts stop here when a step needs your OK." />
      : <EmptyState icon={<Search />} title="Nothing matches" sentence="Try another word, or clear the search." action={{ label: "Clear", onClick: () => (setQuery(""), onStatus(null), setTab("all")) }} />
    : view === "list"
    ? (
      <div className="flex flex-col">
        {shown.map((row) => (
          <div
            key={row.key}
            role="link"
            tabIndex={0}
            onClick={() => open(row)}
            onKeyDown={(e) => e.key === "Enter" && open(row)}
            className="grid min-h-14 cursor-pointer grid-cols-[minmax(0,1fr)_190px_112px_28px] items-center gap-3 rounded-[10px] px-2 py-1.5 shadow-[0_1px_0_var(--line)] outline-none hover:bg-panel focus-visible:bg-panel max-[720px]:grid-cols-[minmax(0,1fr)_28px]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <RowThumb row={row} />
              <span className="grid min-w-0 gap-px">
                <span className="truncate font-medium">{row.title}</span>
                <span className="truncate text-xs text-fg-2">{row.sub}</span>
              </span>
            </span>
            <span className="min-w-0 max-[720px]:hidden"><RowStatus row={row} /></span>
            <span className="text-xs text-fg-2 max-[720px]:hidden">{ago(row.at, now)}</span>
            <RowMenu row={row} onOpen={() => open(row)} onDelete={() => setDeleting(row)} />
          </div>
        ))}
      </div>
    )
    : (
      <div className="grid grid-cols-5 gap-3 max-[1280px]:grid-cols-4 max-[900px]:grid-cols-3">
        {shown.map((row) => (
          <button key={row.key} type="button" onClick={() => open(row)} className="flex min-w-0 cursor-pointer flex-col gap-1.5 text-left">
            <span className="relative aspect-[9/13] overflow-hidden rounded-[12px] bg-ctl-active">
              <GridPicture row={row} />
              <RowStatus row={row} compact className="absolute bottom-2 left-2 max-w-[calc(100%-16px)] !bg-pop" />
            </span>
            <b className="truncate font-medium">{row.title}</b>
            <span className="line-clamp-2 text-xs text-fg-2">{row.sub} · {ago(row.at, now)}</span>
          </button>
        ))}
      </div>
    )

  return (
    <section aria-label="Recents">
      <div className="mb-2.5 flex items-center gap-2">
        <div role="tablist" aria-label="Show" className="flex gap-0.5">
          {RECENT_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "h-8 cursor-pointer px-2.5 font-medium shadow-[inset_0_-2px_0_transparent]",
                tab === t.value ? "text-fg shadow-[inset_0_-2px_0_var(--fg)]" : "text-fg-2 hover:text-fg"
              )}
            >
              {t.label}<span className="ml-1 font-normal text-fg-3">{counts[t.value]}</span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {status === null ? (
          <Menu label="Filter by status" trigger={<><Plus />Status</>}>
            <MenuNote>Show only</MenuNote>
            {STATUS_FILTERS.map((f) => <MenuItem key={f.value} onClick={() => onStatus(f.value)}>{f.label}</MenuItem>)}
          </Menu>
        ) : (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-ctl bg-ctl pr-1 pl-2.5 text-xs whitespace-nowrap text-fg-1">
            <span className="text-fg-2">Status</span>
            <Menu label="Change the status filter" trigger={statusLabel} triggerClassName="!h-6 !px-1 !text-xs !text-fg-1">
              <MenuChoices value={status} onChange={onStatus} options={STATUS_FILTERS} />
              <MenuSeparator />
              <MenuItem onClick={() => onStatus(null)}>Show everything</MenuItem>
            </Menu>
            <button type="button" aria-label="Clear the status filter" onClick={() => onStatus(null)} className="grid size-5 cursor-pointer place-items-center rounded-[5px] text-fg-2 hover:bg-ctl hover:text-fg">
              <X className="size-3" />
            </button>
          </span>
        )}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <label className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-2 left-2.5 size-4 text-fg-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search shorts and video sets…"
            aria-label="Search shorts and video sets"
            className="h-8 w-full rounded-ctl border border-line-2 bg-transparent pr-2.5 pl-8 text-fg outline-none placeholder:text-fg-3 focus:border-lemon focus:shadow-[0_0_0_3px_var(--lemon-soft)]"
          />
        </label>
        <Segmented
          label="Show as"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: <List aria-label="List" className="size-3.5" /> },
            { value: "grid", label: <LayoutGrid aria-label="Grid" className="size-3.5" /> }
          ]}
        />
      </div>
      {body}
      <DeleteDialog row={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}

function RowMenu({ row, onOpen, onDelete }: { readonly row: RecentRow; readonly onOpen: () => void; readonly onDelete: () => void }) {
  const busy = row.status._tag === "Running" || row.status._tag === "Reading" || row.status._tag === "Searching"
  return (
    // the menu's clicks shouldn't open the row
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Menu label={`More for ${row.title}`}>
        <MenuItem onClick={onOpen}>Open</MenuItem>
        <MenuSeparator />
        <MenuItem tone="danger" disabled={busy} onClick={onDelete}>Delete {KIND_WORD[row.kind]}…</MenuItem>
      </Menu>
    </span>
  )
}

// Deleting from Home asks first. A video or set still used by shorts (or a set) can't go; the server says why.
function DeleteDialog({ row, onClose }: { readonly row: RecentRow | null; readonly onClose: () => void }) {
  const removeShort = useAtomSet(deleteProject, { mode: "promise" })
  const removeSet = useAtomSet(deleteVideoSet, { mode: "promise" })
  const removeVideo = useAtomSet(deleteSource, { mode: "promise" })
  const refresh = useAtomRefresh(overviewAtom)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    setError(null)
    onClose()
  }
  const confirm = () => {
    if (row === null) return
    setBusy(true)
    setError(null)
    const target = row.target
    const done = target._tag === "Short"
      ? removeShort({ payload: { id: ProjectId.make(target.projectId) } })
      : target._tag === "Set"
      ? removeSet({ payload: { id: SourceSetId.make(target.setId) } })
      : removeVideo({ payload: { id: SourceId.make(target.sourceId) } })
    done
      .then(() => (refresh(), close()))
      .catch((e: unknown) =>
        setError(typeof e === "object" && e !== null && "message" in e && typeof e.message === "string" ? `Couldn't delete it: ${e.message}.` : "Couldn't delete it.")
      )
      .finally(() => setBusy(false))
  }
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => !open && close()}
      title={row === null ? "" : `Delete “${row.title}”?`}
      description={row === null ? undefined : `The ${KIND_WORD[row.kind]} and its work leave your library. This can't be undone.`}
      footer={
        <>
          {error === null ? null : <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="ghost" onClick={close}>Keep</Button>
          <Button variant="primary" disabled={busy} onClick={confirm}>Delete</Button>
        </>
      }
    />
  )
}
