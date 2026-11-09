import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { MAX_SHORT_SOURCES, type Project, type SourceId, type SourceRights } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Input } from "@viral/ui/primitives/input"
import { cn } from "@viral/ui/cn"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Check, FolderOpen } from "lucide-react"
import { useEffect, useState } from "react"
import { desktop } from "../../config/server-url.ts"
import { clock } from "../../lib/format.ts"
import { overviewAtom } from "../home/overview.ts"
import { RIGHTS_CHOICES } from "../videos/video-values.ts"
import { createSource, startSourceRun } from "../videos/videos-api.ts"
import { addableVideos, refusalText, rerunStep, stepTitle, typedVideo } from "./add-video-values.ts"
import { addSourceToProject, startShortRun } from "./shorts-api.ts"

// "Add a video to this short": one from your library, or a link or file (with who owns it). It's added after the
// short's other videos; nothing re-runs unless you ask, and like the Brief, it offers to re-run from the first step so
// the agents can use it. A new link or file starts being read right away.
export function AddVideoDialog({ project, open, onOpenChange, running, onAdded }: {
  readonly project: Project
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  // a run is going now: the video is only added, for the next run
  readonly running: boolean
  readonly onAdded: () => void
}) {
  const home = Option.getOrNull(AsyncResult.value(useAtomValue(overviewAtom)))
  const create = useAtomSet(createSource, { mode: "promise" })
  const read = useAtomSet(startSourceRun, { mode: "promise" })
  const add = useAtomSet(addSourceToProject, { mode: "promise" })
  const start = useAtomSet(startShortRun, { mode: "promise" })
  const [picked, setPicked] = useState<SourceId | null>(null)
  const [typed, setTyped] = useState("")
  const [rights, setRights] = useState<SourceRights>("unconfirmed")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setPicked(null)
      setTyped("")
      setError(null)
    }
  }, [open])

  const from = rerunStep(project.format)
  const library = addableVideos(home?.videos ?? [], project.sourceIds)
  const link = typedVideo(typed)
  const full = project.sourceIds.length >= MAX_SHORT_SOURCES
  const ready = !full && !busy && (picked !== null || link !== null)

  const submit = async (rerun: boolean) => {
    setBusy(true)
    setError(null)
    try {
      let sourceId = picked
      if (link !== null) {
        const source = await create({ payload: { origin: link, rights, rightsNote: null } })
        // read it now, so its stills and story are there before the short's next run needs them
        await read({ payload: { sourceId: source.id } })
        sourceId = source.id
      }
      if (sourceId === null) return
      await add({ payload: { id: project.id, sourceId } })
      if (rerun) await start({ payload: { projectId: project.id, from } })
      onOpenChange(false)
      onAdded()
    } catch (e) {
      setError(refusalText(e, "Couldn't add the video. Is the server running?"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a video to this short"
      description={`It goes after the short's ${project.sourceIds.length === 1 ? "video" : `${project.sourceIds.length} videos`}. Its clips and pictures can be used once the short runs again from ${stepTitle(from)}.`}
      className="w-[520px]"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ready} onClick={() => void submit(false)}>{running ? "Add" : "Just add"}</Button>
          {running ? null : (
            <Button variant="primary" disabled={!ready} onClick={() => void submit(true)}>Add and re-run from {stepTitle(from)}</Button>
          )}
        </>
      }
    >
      {full ? <p className="m-0 text-xs text-wait">A short can use up to {MAX_SHORT_SOURCES} videos. Remove one first.</p> : null}
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-fg-1">A link or a file</span>
        <div className="flex gap-2">
          <Input
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              if (e.target.value.trim() !== "") setPicked(null)
            }}
            placeholder={desktop === undefined ? "A link, or the full path of a video file" : "A link"}
            aria-label="A video link or file"
            className="flex-1"
            disabled={full}
          />
          {desktop === undefined ? null : (
            <Button
              disabled={full}
              onClick={() => void desktop?.openFile("video").then((path) => {
                if (path !== null) {
                  setTyped(path)
                  setPicked(null)
                }
              })}
            >
              <FolderOpen />Choose a file
            </Button>
          )}
        </div>
      </div>
      {link === null ? null : (
        <div className="grid gap-1">
          <span className="text-xs font-medium text-fg-1">Who owns this footage?</span>
          {RIGHTS_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() => setRights(choice.value)}
              className={cn(
                "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-ctl bg-item px-3 py-1.5 text-left hover:bg-item-hover",
                rights === choice.value && "shadow-[inset_0_0_0_1px_var(--lemon)]"
              )}
            >
              <span>
                <span className="block text-sm font-medium">{choice.title}</span>
                <span className="block text-xs text-fg-2">{choice.sub}</span>
              </span>
              {rights === choice.value ? <Check className="size-4 text-lemon-fg" /> : null}
            </button>
          ))}
        </div>
      )}
      {library.length === 0 ? null : (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-fg-1">Or one from your library</span>
          <div className="grid max-h-[220px] gap-[3px] overflow-auto">
            {library.map(({ source, thumb }) => {
              const chosen = picked === source.id
              const sub = [source.channel, source.durationS === null ? null : clock(source.durationS)].filter((p) => p !== null).join(" · ")
              return (
                <button
                  key={source.id}
                  type="button"
                  disabled={full}
                  onClick={() => {
                    setPicked(chosen ? null : source.id)
                    setTyped("")
                  }}
                  className={cn(
                    "grid cursor-pointer grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-ctl bg-item px-2 py-1.5 text-left hover:bg-item-hover disabled:cursor-not-allowed disabled:opacity-45",
                    chosen && "shadow-[inset_0_0_0_1px_var(--lemon)]"
                  )}
                >
                  {thumb === null ? <span className="aspect-video w-12 rounded-[4px] bg-ctl-active" /> : <img src={thumb} alt="" className="aspect-video w-12 rounded-[4px] object-cover" loading="lazy" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{source.title ?? "Untitled video"}</span>
                    <span className="block truncate text-xs text-fg-2">{sub === "" ? "Not read yet" : sub}</span>
                  </span>
                  {chosen ? <Check className="size-4 text-lemon-fg" /> : null}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {running ? <p className="m-0 text-xs text-fg-2">A run is going now, so the video is added for the next run. Re-run from {stepTitle(from)} once it's done.</p> : null}
      {error === null ? null : <p className="m-0 text-xs text-danger">{error}</p>}
    </Dialog>
  )
}
