import { useAtomSet } from "@effect/atom-react"
import type { Shortlist, SourceId, SourceSetId } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Textarea } from "@viral/ui/primitives/textarea"
import { Check } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { serverUrl } from "../../config/server-url.ts"
import { homeFileUrl } from "../../lib/media-url.ts"
import { replaceResearchVideo } from "./research-api.ts"
import { videoFacts } from "./research-values.ts"

export interface ReplaceTarget {
  readonly sourceId: SourceId
  readonly title: string
  // why it needs replacing, in a few words ("YouTube blocked the download", "no after: it ends at the vet")
  readonly why: string
}

// "Replace this video": a backup takes its place (downloaded now), or the research searches again for that spot and
// its new list waits for you. Either way the set reads the new video and suggests its shorts again.
export function ReplaceDialog({ setId, target, shortlist, onClose, onDone }: {
  readonly setId: SourceSetId
  readonly target: ReplaceTarget | null
  readonly shortlist: Shortlist | null
  readonly onClose: () => void
  readonly onDone: () => void
}) {
  const replace = useAtomSet(replaceResearchVideo, { mode: "promise" })
  const backups = shortlist?.backups ?? []
  // a backup's id, or "search" to search again
  const [choice, setChoice] = useState<string>("search")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (target === null) return
    setChoice(backups[0]?.videoId ?? "search")
    setReason(target.why)
    setError(null)
  }, [target])

  const go = () => {
    if (target === null) return
    setBusy(true)
    setError(null)
    replace({
      payload: { setId, sourceId: target.sourceId, backup: choice === "search" ? null : choice, ...(choice === "search" ? { reason: reason.trim() } : {}) }
    })
      .then(onDone)
      .catch(() => setError("Couldn't replace it. Is the server running?"))
      .finally(() => setBusy(false))
  }

  const option = (key: string, selected: boolean, body: ReactNode) => (
    <button
      key={key}
      type="button"
      onClick={() => setChoice(key)}
      className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-ctl bg-item px-3 py-2 text-left hover:bg-item-hover ${selected ? "shadow-[inset_0_0_0_1px_var(--lemon)]" : ""}`}
    >
      {body}
      {selected ? <Check className="size-4 text-lemon-fg" /> : <span className="size-4" />}
    </button>
  )

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={target === null ? "" : `Replace “${target.title}”`}
      description={target?.why}
      footer={
        <>
          {error === null ? null : <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || (choice === "search" && reason.trim() === "")} onClick={go}>
            {choice === "search" ? "Search again" : "Use the backup"}
          </Button>
        </>
      }
    >
      <div className="grid gap-[3px]">
        {backups.map((b) =>
          option(b.videoId, choice === b.videoId, (
            <span className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-center gap-2.5">
              {b.thumbnail === null
                ? <span className="aspect-video w-[72px] rounded-[5px] bg-ctl-active" />
                : <img src={homeFileUrl(serverUrl, b.thumbnail)} alt="" className="aspect-video w-[72px] rounded-[5px] object-cover" />}
              <span className="min-w-0">
                <span className="block truncate font-medium">Use the backup: {b.title}</span>
                <span className="block truncate text-xs text-fg-2">{videoFacts(b, false)}</span>
              </span>
            </span>
          ))
        )}
        {option("search", choice === "search", (
          <span className="min-w-0">
            <span className="block font-medium">Search again for this spot</span>
            <span className="block text-xs text-fg-2">The research looks for another video; its list waits for you before anything downloads.</span>
          </span>
        ))}
      </div>
      {choice === "search" ? (
        <Textarea
          aria-label="What the new video should have"
          className="mt-2"
          placeholder="e.g. It needs the before, the vet and the after on camera."
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
      ) : null}
    </Dialog>
  )
}
