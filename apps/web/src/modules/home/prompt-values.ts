import { MAX_SHORT_SOURCES, type ProjectFormat } from "@viral/contracts"

// What Home's box understood from what you typed, pasted or dropped:
//   Idea   plain words: Viral finds the videos on YouTube first
//   Links  one or more links (with any words besides them, which become the brief for several)
//   File   one video file from this Mac (dropped, chosen with +, or its full path typed in a browser)
//   Files  several files, made into one set like several links
//   Empty  nothing to start from yet
export type Prompt =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Idea"; readonly text: string }
  | { readonly _tag: "Links"; readonly urls: ReadonlyArray<string>; readonly rest: string }
  | { readonly _tag: "File"; readonly path: string }
  | { readonly _tag: "Files"; readonly paths: ReadonlyArray<string>; readonly rest: string }

// A video to start from: a link, or a file on this Mac.
export type VideoInput = { readonly _tag: "Url"; readonly url: string } | { readonly _tag: "File"; readonly path: string }

// An idea needs a few letters before it's one.
const MIN_IDEA = 3

// A link: with its scheme, or the bare sites people paste without one ("youtu.be/…", "www.youtube.com/…").
const LINK = /\bhttps?:\/\/[^\s<>"']+|\b(?:www\.|m\.)?(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|vimeo\.com|x\.com|twitter\.com)\/[^\s<>"']+/gi
// punctuation that ends a sentence rather than the link ("…watch?v=abc).")
const TRAILING = /[.,;:!?)\]}'"»]+$/

const normalize = (raw: string) => {
  const url = raw.replace(TRAILING, "")
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

// The links in a text, each once, in the order they appear.
export const linksIn = (text: string): ReadonlyArray<string> => [...new Set([...text.matchAll(LINK)].map((m) => normalize(m[0])))]

// A typed path to a file on this Mac: one line, starting at the root.
const isPath = (text: string) => /^\/\S/.test(text) && !text.includes("\n")

const squash = (text: string) => text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim()

export const readPrompt = (text: string, files: ReadonlyArray<string>): Prompt => {
  const words = text.trim()
  if (files.length === 1) return { _tag: "File", path: files[0]! }
  if (files.length > 1) return { _tag: "Files", paths: files, rest: words }
  const urls = linksIn(words)
  if (urls.length > 0) return { _tag: "Links", urls, rest: squash(words.replace(LINK, " ")) }
  if (isPath(words)) return { _tag: "File", path: words }
  if (words.length >= MIN_IDEA) return { _tag: "Idea", text: words }
  return { _tag: "Empty" }
}

// The videos a prompt starts from, in order (none for an idea).
export const videosOf = (prompt: Prompt): ReadonlyArray<VideoInput> => {
  switch (prompt._tag) {
    case "Links":
      return prompt.urls.map((url) => ({ _tag: "Url", url }))
    case "File":
      return [{ _tag: "File", path: prompt.path }]
    case "Files":
      return prompt.paths.map((path) => ({ _tag: "File", path }))
    default:
      return []
  }
}

// The words besides the videos: for several, what their shorts should achieve.
export const briefOf = (prompt: Prompt) => prompt._tag === "Links" || prompt._tag === "Files" ? prompt.rest : ""

// What Send does: find videos for an idea, read one video, or make a set from several.
export type Start = "find" | "one" | "set" | "none"
export const startOf = (prompt: Prompt): Start => {
  if (prompt._tag === "Empty") return "none"
  if (prompt._tag === "Idea") return "find"
  return videosOf(prompt).length > 1 ? "set" : "one"
}

// The chip in the box's footer: which input it understood.
export const promptChip = (prompt: Prompt): { readonly icon: "idea" | "link" | "file" | null; readonly label: string } => {
  switch (prompt._tag) {
    case "Empty":
      return { icon: null, label: "An idea, a link or a file" }
    case "Idea":
      return { icon: "idea", label: "Idea · finds videos" }
    case "Links":
      return prompt.urls.length === 1 ? { icon: "link", label: "Link · downloads" } : { icon: "link", label: `${prompt.urls.length} links · one short` }
    case "File":
      return { icon: "file", label: "File · from this Mac" }
    case "Files":
      return { icon: "file", label: `${prompt.paths.length} files · one short` }
  }
}

// Why Send can't go yet, in plain words; null when it can.
export const promptProblem = (prompt: Prompt, brief: string): string | null => {
  const videos = videosOf(prompt).length
  if (videos > MAX_SHORT_SOURCES) return `Up to ${MAX_SHORT_SOURCES} videos in one short; remove ${videos - MAX_SHORT_SOURCES}.`
  if (videos > 1 && brief.trim() === "") return "Say what these shorts should achieve."
  return null
}

// A file's name and the folder it's in, the way Finder people say it ("candy.mp4", "~/Movies").
export const fileParts = (path: string, home?: string): { readonly name: string; readonly folder: string } => {
  const cut = path.lastIndexOf("/")
  const name = cut < 0 ? path : path.slice(cut + 1)
  let folder = cut <= 0 ? "/" : path.slice(0, cut)
  const user = home ?? /^\/Users\/[^/]+/.exec(path)?.[0]
  if (user !== undefined && (folder === user || folder.startsWith(`${user}/`))) folder = `~${folder.slice(user.length)}`
  return { name, folder }
}

// The rights choice in the box, in its short words; the full sentence shows on hover.
export const RIGHTS_SHORT = { owned: "Mine", licensed: "Allowed", unconfirmed: "Not sure" } as const

// --- the format cards: a hint only (Viral still suggests three shorts) ---

export type FormatHint = "narrated" | "cut-down" | "ranking" | "idea"

export const FORMAT_CARDS: ReadonlyArray<{ readonly id: FormatHint; readonly title: string; readonly line: string; readonly placeholder: string }> = [
  { id: "narrated", title: "Narrated", line: "A voice tells the story over the best footage, with real lines.", placeholder: "Paste a link to the video, or type an idea…" },
  { id: "cut-down", title: "Cut-down", line: "The creator's own best moments, trimmed to a minute.", placeholder: "Paste a link to the video, or drop it here…" },
  { id: "ranking", title: "Ranking", line: "A narrator counts down #5 to #1, one video each, with real lines.", placeholder: "Type what to rank, e.g. Top 5 animal rescue comebacks…" },
  { id: "idea", title: "From an idea", line: "Type a topic; Viral finds the videos on YouTube first.", placeholder: "Type a topic; Viral finds the videos on YouTube…" }
]

export const DEFAULT_PLACEHOLDER = "Type an idea, paste a YouTube link, or drop a video here…"

// The short format a card stands for (the idea card has none of its own).
export const formatOfHint = (hint: FormatHint | null): ProjectFormat | null => hint === null || hint === "idea" ? null : hint

// "Made as" for an idea: what the short will be, from the card you picked or the idea's own words.
export const madeAs = (hint: FormatHint | null, ranking: boolean, videos: number) => {
  if (hint === "narrated") return "A narrated short across the videos"
  if (hint === "cut-down") return "A cut-down of the best moments"
  if (hint === "ranking" || ranking) return `A ranking of ${videos}`
  return "Three suggested shorts across the videos"
}
