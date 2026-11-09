import type { Shortlist } from "@viral/contracts"

const clock = (s: number | null) => {
  if (s === null) return "?:??"
  const t = Math.round(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}
const views = (v: number | null) =>
  v === null ? "? views" : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M views` : v >= 1000 ? `${Math.round(v / 1000)}k views` : `${v} views`

// The shortlist as the gate shows it: each video's part, title, channel · length · views, why, and the moments it
// expects; then the backups and the copyright note.
export const describeShortlist = (list: Shortlist) => {
  const row = (v: Shortlist["picks"][number], i: number, mark: string) =>
    `  ${mark}${String(i + 1).padStart(2)}. ${v.part}\n       ${v.title}  (${v.videoId})\n       ${v.channel ?? "unknown channel"} · ${clock(v.durationS)} · ${views(v.views)}${v.uploadDate === null ? "" : ` · ${v.uploadDate}`}\n` +
    `       ${v.why}${v.moments.length === 0 ? "" : `\n       expects (a guess): ${v.moments.map((m) => `${m.label}${m.at === null ? "" : ` ~${clock(m.at)}`}`).join(", ")}`}`
  return [
    `  ${list.summary}`,
    list.searches.length === 0 ? "" : `  ${list.searches.length} searches: ${list.searches.join(" · ")}`,
    ...list.picks.map((v, i) => row(v, i, "")),
    list.backups.length === 0 ? "" : "  Backups (downloaded only if needed):",
    ...list.backups.map((v, i) => row(v, i, "b")),
    "  These videos belong to their channels and can draw Content ID claims — more likely for a ranking, which plays",
    "  each video's own sound. Each channel is kept for the credits."
  ].filter((line) => line !== "").join("\n") + "\n"
}
