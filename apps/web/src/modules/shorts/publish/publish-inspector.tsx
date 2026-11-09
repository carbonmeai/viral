import type { PostText, PublishedShort, PublishStatus, Source, StageRun } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Input } from "@viral/ui/primitives/input"
import { Menu, MenuItem } from "@viral/ui/primitives/menu"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { Textarea } from "@viral/ui/primitives/textarea"
import { cn } from "@viral/ui/cn"
import { FileText, FolderOpen, Image, Pencil, RefreshCw, RotateCcw, Type, Video } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useState } from "react"
import { desktop } from "../../../config/server-url.ts"
import { Detail } from "../../system/detail.tsx"
import { InspectorBlock } from "../editor-frame.tsx"
import { type InspectorTab, InspectorTabs } from "../inspector-tabs.tsx"
import { nameOf, useShortVideos } from "../short-videos.tsx"
import { StepDetails } from "../step-details.tsx"
import { parseHashtags, republishLine, rightsNotes, TITLE_CHARS, TITLE_LIMIT, titleChoices } from "./publish-values.ts"
import type { Publish } from "./use-publish.ts"

export type PublishTab = "post" | "files"
const TABS: ReadonlyArray<InspectorTab<PublishTab>> = [
  { id: "post", label: "Post text", icon: Type },
  { id: "files", label: "Files", icon: FolderOpen }
]

export interface PublishedFiles {
  readonly video: string | null
  readonly captions: string | null
  readonly notes: string | null
  readonly thumbnail: string | null
  // the renders folder on this Mac, for Show in Finder
  readonly folder: string
}

type Editing = "title" | "description" | "hashtags"

function FileRow({ icon: Icon, name, ext, url }: { readonly icon: typeof Video; readonly name: string; readonly ext: string; readonly url: string | null }) {
  return (
    <div className="flex h-9 min-w-0 items-center gap-2 rounded-ctl bg-item px-2.5 text-sm">
      <Icon className="size-4 shrink-0 text-fg-2" />
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0 text-xs text-fg-3">{ext}</span>
      {url === null
        ? <span className="ml-auto text-xs text-fg-3">not yet</span>
        : <a className="ml-auto text-xs text-fg-2 hover:text-fg" href={url} target="_blank" rel="noreferrer">Open</a>}
    </div>
  )
}

// What "Publish again" will update, and the button; nothing while the files are current. A re-render going
// (the credit drawn on the video) says where to approve it.
function Republish({ status, publish }: { readonly status: PublishStatus; readonly publish: Publish }) {
  const [confirming, setConfirming] = useState(false)
  if (status.changes.length === 0) {
    return <Detail><span className="text-xs text-fg-2">The files in the renders folder match this post.</span></Detail>
  }
  const rendering = status.busy && status.rerender
  const go = () => (status.replaces.length > 0 ? setConfirming(true) : void publish.publishAgain())
  return (
    <div className="grid gap-2 rounded-ctl bg-item p-3 shadow-[inset_0_0_0_1px_var(--lemon)]">
      <span className="text-sm font-medium">{rendering ? "Re-rendering with the new credit" : status.rerender ? "The credit on the video is out of date" : "The published files are out of date"}</span>
      <span className="text-xs text-fg-2">
        {rendering ? "Approve the new render in the Render step; the files are replaced once it's done." : republishLine(status)}
      </span>
      <Detail><span className="text-xs break-words text-fg-3">{status.files.join(" · ")}</span></Detail>
      {rendering ? null : (
        <div className="flex items-center gap-2">
          <Button variant="primary" size="md" disabled={publish.busy || status.busy} onClick={go}><RefreshCw />Publish again</Button>
          {status.busy ? <span className="text-xs text-fg-2">Once the short's run is done.</span> : null}
        </div>
      )}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Replace the published files?"
        description="The new files have different names, so these will be removed from the renders folder:"
        footer={
          <>
            <Button size="md" onClick={() => setConfirming(false)}>Keep them</Button>
            <Button size="md" variant="primary" onClick={() => {
              setConfirming(false)
              void publish.publishAgain()
            }}>Replace</Button>
          </>
        }
      >
        <ul className="m-0 grid gap-0.5 pl-4 text-sm">{status.replaces.map((f) => <li key={f}>{f}</li>)}</ul>
      </Dialog>
    </div>
  )
}

// One field you're editing: the box, what's wrong with it, and Save / Cancel.
function EditBox({ editing, draft, onDraft, problems, busy, onSave, onCancel }: {
  readonly editing: Editing
  readonly draft: string
  readonly onDraft: (text: string) => void
  readonly problems: ReadonlyArray<string>
  readonly busy: boolean
  readonly onSave: () => void
  readonly onCancel: () => void
}) {
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel()
    if (e.key === "Enter" && (editing !== "description" || e.metaKey)) {
      e.preventDefault()
      onSave()
    }
  }
  const chars = draft.trim().length
  return (
    <div className="grid gap-1.5">
      {editing === "description"
        ? <Textarea autoFocus aria-label="Description" value={draft} onChange={(e) => onDraft(e.target.value)} onKeyDown={keys} />
        : (
          <Input
            autoFocus
            aria-label={editing === "title" ? "Title" : "Hashtags"}
            className="h-8"
            value={draft}
            placeholder={editing === "hashtags" ? "#shorts #candy" : "Your title"}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={keys}
          />
        )}
      {editing === "title" ? (
        <span className={cn("text-xs tabular-nums", chars > TITLE_LIMIT ? "text-danger" : "text-fg-3")}>
          {chars}/{TITLE_LIMIT}{chars > TITLE_CHARS && chars <= TITLE_LIMIT ? ` · a phone shows about the first ${TITLE_CHARS}` : ""}
        </span>
      ) : null}
      {problems.map((p) => <span key={p} className="text-xs text-danger">{p[0]?.toUpperCase()}{p.slice(1)}.</span>)}
      <div className="flex items-center gap-1.5">
        <Button variant="primary" disabled={busy} onClick={onSave}>Save</Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// The publish step's inspector: what publishing again would update, the title to post with (the agent's pick, an
// alternate or your own; the count shows when a phone would cut it off), the description, hashtags and credit, a
// reminder when the footage's rights aren't confirmed, and the files. Your choice and edits are saved on the short.
export function PublishInspector({ metadata, slug, sources, files, publish, stages, tab, onTab }: {
  readonly metadata: PublishedShort
  readonly slug: string
  // the short's videos, V1 first
  readonly sources: ReadonlyArray<Source>
  readonly files: PublishedFiles
  readonly publish: Publish
  readonly stages: ReadonlyArray<StageRun>
  readonly tab: PublishTab
  readonly onTab: (tab: PublishTab) => void
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [draft, setDraft] = useState("")
  const status = publish.status
  const named = useShortVideos()
  const notes = rightsNotes(sources.map((s, i) => ({ name: nameOf(named, i), rights: s.rights, channel: s.channel })))

  const startEdit = (field: Editing, post: PostText) => {
    publish.clearProblems()
    setEditing(field)
    setDraft(field === "title" ? post.title : field === "description" ? post.description : post.hashtags.join(" "))
  }
  const saveEdit = (post: PostText) => {
    if (editing === null) return
    const next = editing === "title"
      ? { ...post, title: draft }
      : editing === "description"
      ? { ...post, description: draft }
      : { ...post, hashtags: parseHashtags(draft) }
    void publish.save(next).then((ok) => {
      if (ok) setEditing(null)
    })
  }
  const editBox = (post: PostText) =>
    editing === null ? null : (
      <EditBox
        editing={editing}
        draft={draft}
        onDraft={setDraft}
        problems={publish.problems}
        busy={publish.busy}
        onSave={() => saveEdit(post)}
        onCancel={() => setEditing(null)}
      />
    )
  const editMenu = (field: Editing, label: string, post: PostText) => (
    <Menu label={`More for the ${field}`}>
      <MenuItem onClick={() => startEdit(field, post)}><Pencil />{label}</MenuItem>
      {status?.edited ? <MenuItem onClick={() => void publish.save(null)}><RotateCcw />Back to the suggested text</MenuItem> : null}
    </Menu>
  )

  let body: ReactNode
  if (tab === "post" && status === null) {
    body = (
      <>
        <Skeleton className="h-24" />
        <Skeleton className="h-16" />
        <Skeleton className="h-10" />
      </>
    )
  } else if (tab === "post" && status !== null) {
    const post = status.post
    const choices = titleChoices(metadata, post.title)
    body = (
      <>
        <Republish status={status} publish={publish} />
        <InspectorBlock title="Title" action={editMenu("title", "Write your own title", post)}>
          {editing === "title" ? editBox(post) : (
            <div role="radiogroup" aria-label="Title" className="grid gap-1 rounded-ctl bg-ctl p-1">
              {choices.map((c) => (
                <button
                  key={c.text}
                  type="button"
                  role="radio"
                  aria-checked={c.text === post.title}
                  disabled={publish.busy}
                  onClick={() => c.text === post.title ? undefined : void publish.save({ ...post, title: c.text })}
                  className={cn(
                    "flex min-h-8 items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-sm outline-none hover:bg-item-hover",
                    c.text === post.title && "bg-item shadow-[inset_0_0_0_1px_var(--lemon)]"
                  )}
                >
                  <span className="min-w-0 flex-1">{c.text}</span>
                  {c.yours ? <span className="shrink-0 text-xs text-fg-2">yours</span> : null}
                  <span className={cn("shrink-0 text-xs tabular-nums", c.tooLong ? "text-danger" : "text-fg-3")}>{c.chars}/{TITLE_CHARS}</span>
                </button>
              ))}
            </div>
          )}
        </InspectorBlock>
        <InspectorBlock title="Description" action={editMenu("description", "Edit the description", post)}>
          {editing === "description"
            ? editBox(post)
            : <p className="m-0 rounded-ctl bg-ctl px-2.5 py-2 text-sm whitespace-pre-wrap">{post.description}</p>}
        </InspectorBlock>
        <InspectorBlock title="Hashtags" action={editMenu("hashtags", "Edit the hashtags", post)}>
          {editing === "hashtags" ? editBox(post) : (
            <div className="flex flex-wrap gap-1.5">
              {post.hashtags.map((h) => <span key={h} className="inline-flex h-6 items-center rounded-chip bg-ctl px-2 text-xs">{h}</span>)}
            </div>
          )}
        </InspectorBlock>
        <InspectorBlock title="Credit">
          <span className="text-sm">
            {status.credit !== null ? `Credit: ${status.credit}` : <span className="text-fg-2">{notes.none}</span>}
          </span>
          {status.credit !== null && notes.noChannel !== null ? <span className="text-xs text-fg-2">{notes.noChannel}</span> : null}
        </InspectorBlock>
        {notes.unconfirmed === null ? null : <span className="text-xs text-wait">{notes.unconfirmed}</span>}
        <StepDetails stages={stages} names={["metadata"]} />
      </>
    )
  } else {
    body = (
      <>
        {status === null ? null : <Republish status={status} publish={publish} />}
        <InspectorBlock
          title="Files"
          action={desktop === undefined ? undefined : (
            <Button variant="ghost" onClick={() => void desktop?.showInFinder(files.folder)}><FolderOpen />Show in Finder</Button>
          )}
        >
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
            <FileRow icon={Video} name="Video" ext=".mp4" url={files.video} />
            <FileRow icon={FileText} name="Captions" ext=".srt" url={files.captions} />
            <FileRow icon={FileText} name="Post text" ext=".md" url={files.notes} />
            <FileRow icon={Image} name="Thumbnail" ext=".jpg" url={files.thumbnail} />
          </div>
          <span className="text-xs break-words text-fg-2">
            {files.thumbnail === null ? "The thumbnail joins them once you approve it." : "Everything you need to post, side by side"}, named {slug}, in {files.folder}.
          </span>
        </InspectorBlock>
      </>
    )
  }
  return (
    <>
      <InspectorTabs tabs={TABS} open={tab} onOpen={onTab} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-auto p-4">{body}</div>
    </>
  )
}
