import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Textarea } from "@viral/ui/primitives/textarea"
import { Sparkles } from "lucide-react"
import { useEffect, useState } from "react"

// Before a proposal becomes a short: an optional brief, in your words, that steers its agents.
export function MakeShortDialog({ title, open, busy, onCancel, onMake }: {
  // the proposal's working title
  readonly title: string
  readonly open: boolean
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onMake: (brief: string | null) => void
}) {
  const [brief, setBrief] = useState("")
  useEffect(() => {
    if (open) setBrief("")
  }, [open])
  const trimmed = brief.trim()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title={`Make “${title}”`}
      description="Optional: tell the agents what this short should achieve. Every step reads it first, through to the thumbnail."
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => onMake(trimmed === "" ? null : trimmed)}>
            <Sparkles />{busy ? "Making…" : "Make this short"}
          </Button>
        </>
      }
    >
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
