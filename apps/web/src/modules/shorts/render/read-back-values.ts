import type { ReadBack, ReadBackCheck } from "@viral/contracts"

// The final-video check as the Render step shows it: the finished short was transcribed and read back against the
// plan; every line is a pass or something to look at, with the moment it's about (click to watch it there).

export interface ReadBackRow {
  readonly ok: boolean
  readonly text: string
  // "0:41.2", the moment it's about; null when it's about the whole short
  readonly time: string | null
  readonly at: number | null
}

export interface ReadBackView {
  // "All 7 checks passed" / "2 things to look at" / "Not read back"
  readonly summary: string
  readonly tone: "ok" | "warn" | "off"
  readonly rows: ReadonlyArray<ReadBackRow>
  // how it was read: "Local Whisper · 7 s"; why it wasn't: "turned off (VIRAL_READ_BACK=off)"
  readonly note: string
}

// "0:41.2" (minutes, seconds to a tenth): precise enough to land on the word.
export const momentOf = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  return `${m}:${(seconds - m * 60).toFixed(1).padStart(4, "0")}`
}

const KIND_ORDER: ReadonlyArray<ReadBackCheck["kind"]> = ["heard", "narration", "real-line", "skipped", "join", "countdown", "closing", "silence"]

export const readBackView = (heard: ReadBack): ReadBackView => {
  if (heard.problem !== null) return { summary: "Not read back", tone: "off", rows: [], note: heard.problem }
  const warnings = heard.checks.filter((c) => !c.ok).length
  // things to look at first, then the passes, each group in the short's order of concerns
  const rows = [...heard.checks]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(a.c.ok) - Number(b.c.ok) || KIND_ORDER.indexOf(a.c.kind) - KIND_ORDER.indexOf(b.c.kind) || a.i - b.i)
    .map(({ c }) => ({ ok: c.ok, text: c.text, time: c.at === null ? null : momentOf(c.at), at: c.at }))
  return {
    summary: warnings === 0 ? `All ${heard.checks.length} checks passed` : `${warnings} ${warnings === 1 ? "thing" : "things"} to look at`,
    tone: warnings === 0 ? "ok" : "warn",
    rows,
    note: `${heard.provider === "grok" ? "Grok" : "Local Whisper"} · ${heard.seconds.toFixed(0)} s`
  }
}

// The Render step's toggle under the player: "Check sheet", or with what the read-back found to look at.
export const checkToggleLabel = (heard: ReadBack | undefined) => {
  const warnings = heard === undefined || heard.problem !== null ? 0 : heard.checks.filter((c) => !c.ok).length
  return warnings === 0 ? "Check sheet" : `Check sheet · ${warnings} to look at`
}
