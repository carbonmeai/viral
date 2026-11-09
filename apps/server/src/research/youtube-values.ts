import { Schema } from "effect"

// What a search result tells about a video: no request beyond the search itself.
export interface VideoFound {
  readonly videoId: string
  readonly title: string
  readonly channel: string | null
  readonly durationS: number | null
  readonly views: number | null
  // true for a live stream or a premiere that hasn't happened; null when the result doesn't say
  readonly live: boolean | null
}

// What a lookup adds: the upload date, the description, the chapter list and the start of the captions.
export interface VideoDetails extends VideoFound {
  readonly uploadDate: string | null
  readonly description: string
  readonly chapters: ReadonlyArray<{ readonly start: number; readonly title: string }>
  // timestamped caption lines from the start of the video, or null when it has none in English
  readonly captions: string | null
}

// yt-dlp's JSON, read loosely: only the id is required (YouTube changes, and the rest is optional).
const Entry = Schema.Struct({
  id: Schema.String,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  channel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  uploader: Schema.optionalKey(Schema.NullOr(Schema.String)),
  duration: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  view_count: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  live_status: Schema.optionalKey(Schema.NullOr(Schema.String)),
  is_live: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  upload_date: Schema.optionalKey(Schema.NullOr(Schema.String)),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  chapters: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({
    start_time: Schema.Finite,
    title: Schema.optionalKey(Schema.NullOr(Schema.String))
  }))))
})
type Entry = typeof Entry.Type
const decodeEntry = Schema.decodeUnknownOption(Entry)
const SearchJson = Schema.fromJsonString(Schema.Struct({ entries: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))) }))
const DetailsJson = Schema.fromJsonString(Schema.Unknown)

const liveOf = (entry: Entry): boolean | null => {
  if (entry.is_live === true) return true
  const status = entry.live_status ?? null
  if (status === null) return entry.is_live === false ? false : null
  return status === "is_live" || status === "is_upcoming" || status === "post_live"
}

const found = (entry: Entry): VideoFound => ({
  videoId: entry.id,
  title: entry.title ?? entry.id,
  channel: entry.channel ?? entry.uploader ?? null,
  durationS: entry.duration ?? null,
  views: entry.view_count ?? null,
  live: liveOf(entry)
})

// The videos in `yt-dlp --flat-playlist --dump-single-json "ytsearch8:…"`; anything that isn't a video (a channel or
// a playlist result has no 11-character id) is left out.
export const parseSearch = (json: string): ReadonlyArray<VideoFound> => {
  const decoded = Schema.decodeOption(SearchJson)(json)
  if (decoded._tag === "None") return []
  return (decoded.value.entries ?? []).flatMap((raw) => {
    const entry = decodeEntry(raw)
    return entry._tag === "Some" && /^[\w-]{11}$/.test(entry.value.id) ? [found(entry.value)] : []
  })
}

// "20260207" → "2026-02-07"
const isoDate = (date: string | null | undefined) =>
  date !== null && date !== undefined && /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : null

// One video's `yt-dlp --dump-single-json` (null when it isn't one), with the captions read separately.
export const parseDetails = (json: string, captions: string | null): VideoDetails | null => {
  const raw = Schema.decodeOption(DetailsJson)(json)
  if (raw._tag === "None") return null
  const entry = decodeEntry(raw.value)
  if (entry._tag === "None") return null
  const e = entry.value
  return {
    ...found(e),
    uploadDate: isoDate(e.upload_date),
    description: e.description ?? "",
    chapters: (e.chapters ?? []).map((c) => ({ start: c.start_time, title: c.title ?? "" })),
    captions
  }
}

// At most this many characters of captions go to the agent, and one line covers about this many seconds.
export const CAPTION_CHARS = 2500
const CAPTION_LINE_SECONDS = 15

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

const vttTime = (text: string) => {
  const parts = text.trim().split(":").map(Number)
  return parts.reduce((total, part) => total * 60 + part, 0)
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " }

// The start of a WebVTT caption file as "[0:42] text" lines of about 15 seconds each, at most `limit` characters.
// YouTube's automatic captions repeat each line as it scrolls; every line is kept once.
export const captionsExcerpt = (vtt: string, limit = CAPTION_CHARS): string | null => {
  const cues = vtt.replace(/\r/g, "").split(/\n\n+/)
  const lines: Array<{ readonly at: number; readonly text: string }> = []
  let previous = ""
  for (const cue of cues) {
    const rows = cue.split("\n")
    const timing = rows.findIndex((r) => r.includes("-->"))
    if (timing < 0) continue
    const at = vttTime(rows[timing]!.split("-->")[0]!)
    for (const row of rows.slice(timing + 1)) {
      const text = row.replace(/<[^>]*>/g, "").replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e).replace(/\s+/g, " ").trim()
      if (text === "" || text === previous) continue
      previous = text
      lines.push({ at, text })
    }
  }
  if (lines.length === 0) return null
  const out: Array<string> = []
  let length = 0
  let group: { at: number; words: Array<string> } | null = null
  const flush = () => {
    if (group === null) return true
    const line = `[${clock(group.at)}] ${group.words.join(" ")}`
    group = null
    if (length + line.length > limit) return false
    out.push(line)
    length += line.length + 1
    return true
  }
  for (const line of lines) {
    if (group !== null && line.at - group.at >= CAPTION_LINE_SECONDS && !flush()) return `${out.join("\n")}\n(captions continue)`
    if (group === null) group = { at: line.at, words: [] }
    group.words.push(line.text)
  }
  if (!flush()) return `${out.join("\n")}\n(captions continue)`
  return out.join("\n")
}

// Why yt-dlp failed, in the agent's and your words: YouTube refusing (a 403 or 429, a bot check), a video that's
// gone or private, or anything else.
export type RefusalKind = "blocked" | "unavailable" | "failed"
export const classifyFailure = (stderr: string): { readonly kind: RefusalKind; readonly message: string } => {
  const error = stderr.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("ERROR:")).at(-1) ?? stderr.trim().split("\n").at(-1) ?? ""
  const said = error.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]*:?\s*)?/, "").slice(0, 300)
  if (/HTTP Error 4(03|29)|Sign in to confirm|not a bot|rate.?limit|Too Many Requests/i.test(stderr)) {
    return { kind: "blocked", message: `YouTube refused the request (${said || "blocked"})` }
  }
  if (/Video unavailable|Private video|removed|not available|members.only|account .* terminated|does not exist|copyright/i.test(stderr)) {
    return { kind: "unavailable", message: said || "the video is unavailable" }
  }
  return { kind: "failed", message: said || "yt-dlp failed" }
}

// "12.6M views", "49k views", "572 views"
export const viewsLabel = (views: number | null) => {
  if (views === null) return "views unknown"
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(views >= 10_000_000 ? 0 : 1)}M views`
  if (views >= 1_000) return `${Math.round(views / 1_000)}k views`
  return `${views} ${views === 1 ? "view" : "views"}`
}
