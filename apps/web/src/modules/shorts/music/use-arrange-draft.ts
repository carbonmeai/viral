import { useAtomSet } from "@effect/atom-react"
import type { MusicBed, MusicBlock, ProjectId } from "@viral/contracts"
import { useMemo, useState } from "react"
import { arrangeMusic, previewMusicArrangement } from "../shorts-api.ts"
import { blocksOf, plainProblems, sameBlocks } from "./music-values.ts"

// Your arrangement in progress: its blocks, and whether it is the automatic one (reset to automatic, not yet
// changed), which is applied as "automatic" rather than as these blocks.
export interface ArrangeDraft {
  readonly blocks: ReadonlyArray<MusicBlock>
  readonly automatic: boolean
}

// A preview bed: the draft it was made for, the bed and its file.
interface Heard {
  readonly draft: ArrangeDraft
  readonly bed: MusicBed
  readonly media: string
}

const refused = (error: unknown, fallback: string): ReadonlyArray<string> => {
  const tagged = (typeof error === "object" && error !== null ? error : {}) as { readonly problems?: unknown; readonly message?: unknown }
  if (Array.isArray(tagged.problems)) return plainProblems(tagged.problems.filter((p): p is string => typeof p === "string"))
  return [typeof tagged.message === "string" && tagged.message !== "" ? tagged.message : fallback]
}

// The arrangement editor's state: a draft over the short's bed (with undo), a preview of it to listen to without
// changing the short, and applying it (which re-runs the short from assemble). The draft is dropped once applied.
export function useArrangeDraft({ projectId, bed, stopRun, onApplied }: {
  readonly projectId: ProjectId
  readonly bed: MusicBed | null
  // stops a run that's going, so the re-run can start
  readonly stopRun: () => Promise<unknown>
  readonly onApplied: () => void
}) {
  const arrange = useAtomSet(arrangeMusic, { mode: "promise" })
  const previewOf = useAtomSet(previewMusicArrangement, { mode: "promise" })
  const [draft, setDraft] = useState<ArrangeDraft | null>(null)
  const [history, setHistory] = useState<ReadonlyArray<ArrangeDraft | null>>([])
  const [selected, setSelected] = useState(0)
  const [heard, setHeard] = useState<Heard | null>(null)
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null)
  const [problems, setProblems] = useState<ReadonlyArray<string>>([])

  const applied = useMemo(() => (bed?.arrangement === undefined ? null : blocksOf(bed.arrangement)), [bed])
  const blocks = draft?.blocks ?? applied

  const change = (next: ArrangeDraft | null) => {
    setHistory((h) => [...h.slice(-49), draft])
    // back to exactly what's applied is no draft at all
    const unchanged = next !== null && applied !== null && sameBlocks(next.blocks, applied) && (!next.automatic || bed?.arrangement?.automatic === true)
    setDraft(unchanged ? null : next)
    setProblems([])
  }
  const edit = (next: ReadonlyArray<MusicBlock>, select?: number) => {
    change({ blocks: next, automatic: false })
    if (select !== undefined) setSelected(select)
    else setSelected((k) => Math.min(k, Math.max(0, next.length - 1)))
  }
  const undo = () => {
    const previous = history.at(-1)
    if (previous === undefined) return
    setHistory((h) => h.slice(0, -1))
    setDraft(previous)
    setProblems([])
    setSelected((k) => Math.min(k, Math.max(0, (previous?.blocks ?? applied ?? []).length - 1)))
  }
  const discard = () => {
    setDraft(null)
    setHistory([])
    setProblems([])
    setHeard(null)
  }

  const payload = (d: ArrangeDraft | null) => (d === null || d.automatic ? null : { blocks: d.blocks })
  const preview = (d: ArrangeDraft | null = draft) => {
    setBusy("preview")
    setProblems([])
    return previewOf({ payload: { projectId, arrangement: payload(d) } })
      .then((r) => {
        setHeard({ draft: d ?? { blocks: [], automatic: true }, bed: r.bed, media: r.media })
        return r
      })
      .catch((e: unknown) => {
        setProblems(refused(e, "Couldn’t make a preview. Is the server running?"))
        return null
      })
      .finally(() => setBusy(null))
  }
  // the automatic arrangement as a draft: what it would be now (made by a preview), to apply or edit from
  const resetToAutomatic = () => {
    void preview(null).then((r) => {
      if (r?.bed.arrangement === undefined) return
      const next = { blocks: blocksOf(r.bed.arrangement), automatic: true }
      change(next)
      setSelected(0)
      setHeard({ draft: next, bed: r.bed, media: r.media })
    })
  }
  const apply = () => {
    if (draft === null) return
    setBusy("apply")
    setProblems([])
    stopRun()
      .then(() => arrange({ payload: { projectId, arrangement: payload(draft) }, reactivityKeys: [`short:${projectId}`] }))
      .then(() => {
        discard()
        onApplied()
      })
      .catch((e: unknown) => setProblems(refused(e, "Couldn’t apply that. Is the server running?")))
      .finally(() => setBusy(null))
  }

  // the preview is heard only while it's of the draft as it is now
  const current = heard !== null && draft !== null && heard.draft.automatic === draft.automatic && sameBlocks(heard.draft.blocks, draft.blocks) ? heard : null
  return {
    draft,
    blocks,
    selected: Math.min(selected, Math.max(0, (blocks?.length ?? 1) - 1)),
    select: setSelected,
    edit,
    undo,
    canUndo: history.length > 0,
    discard,
    preview: () => void preview(),
    heard: current,
    // the last preview made, even of an earlier draft (its bar grid is the song's, whatever the draft)
    lastPreview: heard?.bed ?? null,
    resetToAutomatic,
    apply,
    busy,
    problems
  }
}

export type ArrangeState = ReturnType<typeof useArrangeDraft>
