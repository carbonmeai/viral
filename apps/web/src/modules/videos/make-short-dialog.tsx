import type { ApproachName } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Textarea } from "@viral/ui/primitives/textarea"
import { Sparkles } from "lucide-react"
import { useEffect, useState } from "react"

// A way the caller offers to make the short: null = as the proposal suggests.
export interface ApproachChoice {
  readonly value: ApproachName | null
  readonly label: string
  // a few words under the choice ("an entry per video, each clip's own sound, #1 last")
  readonly hint?: string
}

// Offered on a video set's proposals: as suggested, or as a ranking of every video.
export const SET_APPROACHES: ReadonlyArray<ApproachChoice> = [
  { value: null, label: "As suggested" },
  { value: "ranking", label: "Ranking", hint: "An entry per video, each clip's own sound, #1 last." }
]

// Before a proposal becomes a short: an optional brief, in your words, that steers its agents, and (when the caller
// offers them) how to make it.
export function MakeShortDialog({ title, open, busy, onCancel, onMake, initialBrief = "", description, approaches = [], initialApproach = null }: {
  // the proposal's working title
  readonly title: string
  // the brief to start from (a video set's), and what the dialog says about it
  readonly initialBrief?: string
  readonly description?: string
  readonly open: boolean
  readonly busy: boolean
  readonly onCancel: () => void
  // the chosen approach comes second; null = as suggested (always null when no approaches are offered)
  readonly onMake: (brief: string | null, approach: ApproachName | null) => void
  readonly approaches?: ReadonlyArray<ApproachChoice>
  readonly initialApproach?: ApproachName | null
}) {
  const [brief, setBrief] = useState("")
  const [approach, setApproach] = useState<ApproachName | null>(initialApproach)
  useEffect(() => {
    if (open) {
      setBrief(initialBrief)
      setApproach(initialApproach)
    }
  }, [open, initialBrief, initialApproach])
  const chosen = approaches.find((a) => a.value === approach)
  const trimmed = brief.trim()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title={`Make “${title}”`}
      description={description ?? "Optional: tell the agents what this short should achieve. Every step reads it first, through to the thumbnail."}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => onMake(trimmed === "" ? null : trimmed, approaches.length === 0 ? null : approach)}>
            <Sparkles />{busy ? "Making…" : approach === "ranking" ? "Make a ranking" : "Make this short"}
          </Button>
        </>
      }
    >
      {approaches.length === 0 ? null : (
        <div className="grid gap-1.5">
          <Segmented<string>
            label="Make it as"
            full
            value={approach ?? ""}
            onChange={(v) => setApproach(v === "" ? null : v as ApproachName)}
            options={approaches.map((a) => ({ value: a.value ?? "", label: a.label }))}
          />
          {chosen?.hint === undefined ? null : <span className="text-xs text-fg-2">{chosen.hint}</span>}
        </div>
      )}
      <Textarea
        aria-label="What should this short achieve?"
        placeholder="What should this short achieve? e.g. focus on the friend's reactions"
        value={brief}
        maxLength={600}
        onChange={(e) => setBrief(e.currentTarget.value)}
      />
    </Dialog>
  )
}
