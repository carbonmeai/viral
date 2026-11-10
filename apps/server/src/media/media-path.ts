// What the media route may serve: files in these folders of the Viral home, never the database or anything
// outside it. A path is the file's location relative to the home, e.g.
// "projects/<id>/shot-plan/v2/frames/shot-01.jpg".
export const MEDIA_FOLDERS: ReadonlySet<string> = new Set([
  "sources",
  // a video set's own files (a research's thumbnails)
  "sets",
  "projects",
  "references",
  "music",
  "sounds",
  "renders",
  "voice-previews",
  // thumbnails of links pasted on Home, saved before anything downloads
  "link-previews"
])

// Checks a requested path (already URL-decoded) and returns its segments, or null when it could escape the
// media folders: absolute paths, empty, "." or ".." segments, backslashes and NUL bytes are refused.
export const mediaSegments = (requested: string): ReadonlyArray<string> | null => {
  if (requested === "" || requested.includes("\0") || requested.includes("\\") || requested.startsWith("/")) return null
  const segments = requested.split("/")
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null
  const [folder] = segments
  if (folder === undefined || !MEDIA_FOLDERS.has(folder) || segments.length < 2) return null
  return segments
}

export type ByteRange =
  | { readonly _tag: "Range"; readonly start: number; readonly length: number; readonly contentRange: string }
  | { readonly _tag: "Unsatisfiable"; readonly contentRange: string }

// One `bytes=` range of a file of `size` bytes ("bytes=0-99", "bytes=100-", "bytes=-500"), as browsers ask
// for when seeking audio and video. Null when the header isn't a single range we understand: the whole file
// is sent then.
export const byteRange = (header: string, size: number): ByteRange | null => {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (match === null || (match[1] === "" && match[2] === "")) return null
  const first = match[1] === "" ? null : Number(match[1])
  const last = match[2] === "" ? null : Number(match[2])
  if (first !== null && last !== null && last < first) return null
  const unsatisfiable = { _tag: "Unsatisfiable", contentRange: `bytes */${size}` } as const
  if (size === 0 || (first !== null && first >= size) || (first === null && last === 0)) return unsatisfiable
  const start = first ?? Math.max(0, size - (last ?? 0))
  const end = first === null || last === null || last >= size ? size - 1 : last
  return { _tag: "Range", start, length: end - start + 1, contentRange: `bytes ${start}-${end}/${size}` }
}

// The origins of Viral's own UI: the desktop app's viral://app and a dev server on this machine. Only they may read
// media with fetch (to draw a waveform); any other web page gets no CORS header, so it can't read the files.
export const appOrigin = (origin: string | undefined): string | null =>
  origin !== undefined && /^(viral:\/\/app|https?:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?)$/.test(origin) ? origin : null
