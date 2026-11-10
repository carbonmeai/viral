// A video's short name, made from its title when you haven't given one: the same in the app and in the server's
// words about a short (the chat's change cards), so a video goes by one name everywhere.

// "Video 1", "Video 2"…: a video's place spelled out, for one without a title (never "V1", which reads as a version).
export const videoLabel = (index: number) => `Video ${index + 1}`

// Words a short name leaves out: small words, and the filler video titles are full of.
const FILLER = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "with", "as", "by", "from", "into", "about",
  "vs", "is", "are", "was", "were", "be", "it", "its", "this", "that", "my", "your", "his", "her", "their", "our", "he",
  "she", "they", "we", "i", "you", "me", "him", "them", "us", "how", "why", "what", "when", "who", "which", "i'm",
  "we're", "made", "make", "makes", "making", "built", "build", "building", "tried", "try", "trying", "just", "very",
  "really", "most", "world's", "worlds", "ever", "best", "official", "video", "full", "episode", "part", "new"
])
const NAME_MAX = 18
const capitalized = (word: string) => /^\p{Lu}/u.test(word)
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

// A short name for a video, from its title: a name in it when it has one ("Heidi Klum", "Red Bull"), else its first
// two or three meaningful words ("Extreme candy"), at most ~18 characters; "Video 2" when the title gives nothing.
export const shortVideoName = (title: string | null | undefined, index: number): string => {
  const words = (title ?? "")
    .replace(/\.(mp4|mov|m4v|webm|mkv)$/i, "")
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/[_|#:]+/g, " ")
    .replace(/’/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, ""))
    .filter((w) => w.length > 0)
  if (words.length === 0) return videoLabel(index)
  const meaningful = (w: string) => !FILLER.has(w.toLowerCase())
  // a run of two or more capitalized words is a name, unless the whole title is in title case
  const titleCase = words.filter(capitalized).length / words.length > 0.6
  let picked: ReadonlyArray<string> = []
  if (!titleCase) {
    for (let i = 0; i < words.length && picked.length === 0; i++) {
      let j = i
      while (j < words.length && capitalized(words[j]!) && meaningful(words[j]!)) j++
      if (j - i >= 2) picked = words.slice(i, j)
    }
  }
  if (picked.length === 0) picked = words.filter(meaningful)
  if (picked.length === 0) return videoLabel(index)
  let name = ""
  for (const word of picked.slice(0, 3)) {
    const next = name === "" ? word : `${name} ${word}`
    if (next.length > NAME_MAX) break
    name = next
  }
  if (name === "") name = `${picked[0]!.slice(0, NAME_MAX - 1)}…`
  return capitalize(name)
}

// Every video's short name, by position: the name you gave it (`given`, stored on the video) when there is one, else
// one made from its title; two made-up names that come out the same (or the same as a given one) are spelled out
// ("Video 1", "Video 2") instead.
export const videoNames = (
  titles: ReadonlyArray<string | null | undefined>,
  given: ReadonlyArray<string | null | undefined> = []
): ReadonlyArray<string> => {
  const own = titles.map((_, i) => (given[i] ?? "").trim())
  const made = titles.map((t, i) => shortVideoName(t, i))
  const names = made.map((name, i) => own[i] !== "" ? own[i]! : name)
  return names.map((name, i) =>
    own[i] !== "" ? name : names.filter((n) => n.toLowerCase() === name.toLowerCase()).length > 1 ? videoLabel(i) : name)
}

