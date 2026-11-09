import { useAtomSet } from "@effect/atom-react"
import type { Project } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Textarea } from "@viral/ui/primitives/textarea"
import { Tooltip } from "@viral/ui/primitives/tooltip"
import { Target } from "lucide-react"
import { useEffect, useState } from "react"
import { setProjectBrief, startShortRun } from "./shorts-api.ts"

// The step a changed brief re-runs from: the first agent step of the short.
const firstStep = (format: Project["format"]) =>
  format === "cut-down" ? "sections" as const : format === "ranking" ? "moments" as const : "script" as const

// The short's brief, in the title bar on every step: what it should achieve, in your words. Changing it can
// re-run the short from its first step, or just be saved for the next run.
export function BriefButton({ project, running, onSaved }: {
  readonly project: Project
  // a run is going now: a re-run waits until it's over, so the brief is only saved
  readonly running: boolean
  readonly onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(project.brief ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = useAtomSet(setProjectBrief, { mode: "promise" })
  const start = useAtomSet(startShortRun, { mode: "promise" })
  useEffect(() => {
    if (open) {
      setText(project.brief ?? "")
      setError(null)
    }
  }, [open, project.brief])

  const from = firstStep(project.format)
  const changed = text.trim() !== (project.brief ?? "")
  const submit = (rerun: boolean) => {
    setBusy(true)
    setError(null)
    save({ payload: { id: project.id, brief: text } })
      .then(() => rerun ? start({ payload: { projectId: project.id, from } }).then(() => undefined) : undefined)
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch(() => setError("Couldn't save the brief. Is the server running?"))
      .finally(() => setBusy(false))
  }

  const has = project.brief !== null
  return (
    <>
      <Tooltip content={has ? project.brief : "Tell the agents what this short should achieve"}>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Target />Brief{has ? <span aria-label="set" className="ml-0.5 size-1.5 rounded-full bg-lemon" /> : null}
        </Button>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Brief"
        description="What this short should achieve, in your words. The agents read it first, from the script (or sections) to the thumbnail."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || !changed} onClick={() => submit(false)}>{running ? "Save" : "Just save"}</Button>
            {running ? null : (
              <Button variant="primary" disabled={busy || !changed} onClick={() => submit(true)}>
                Save and re-run from {from === "script" ? "Script" : from === "moments" ? "Ranking" : "Sections"}
              </Button>
            )}
          </>
        }
      >
        <Textarea
          aria-label="Brief"
          placeholder="e.g. focus on the friend's reactions, end on the joke"
          value={text}
          maxLength={600}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        {running ? <p className="m-0 text-xs text-fg-2">A run is going now, so the brief is saved for the next run. Re-run from {from === "script" ? "Script" : from === "moments" ? "Ranking" : "Sections"} once it's done.</p> : null}
        {!running && changed ? <p className="m-0 text-xs text-fg-2">Re-running makes a new {from === "script" ? "script" : from === "moments" ? "ranking" : "set of sections"} and everything after it; what's approved now stays in the history.</p> : null}
        {error === null ? null : <p className="m-0 text-xs text-danger">{error}</p>}
      </Dialog>
    </>
  )
}
