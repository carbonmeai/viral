import type { PostText, ShortMetadata } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"

export const TITLE_CHARS = 40
const DESCRIPTION_CHARS = 300
const HASHTAGS: readonly [number, number] = [3, 6]

// Checks a short's post text: title lengths, a short description, and well-formed hashtags led by #shorts.
export const checkMetadata = (metadata: ShortMetadata): Checked<ShortMetadata> => {
  const problems: Array<string> = []
  const title = metadata.title.trim()
  if (title === "") problems.push("the title is empty")
  if (title.length > TITLE_CHARS) problems.push(`the title is ${title.length} characters; keep it under ${TITLE_CHARS}`)
  const alternates = metadata.alternates.map((a) => a.trim()).filter((a) => a !== "")
  if (alternates.length < 2 || alternates.length > 3) problems.push(`give two or three alternate titles, not ${alternates.length}`)
  for (const alternate of alternates) {
    if (alternate.length > TITLE_CHARS) problems.push(`"${alternate}" is ${alternate.length} characters; keep it under ${TITLE_CHARS}`)
    if (alternate.toLowerCase() === title.toLowerCase()) problems.push(`"${alternate}" repeats the title`)
  }
  const description = metadata.description.trim()
  if (description === "") problems.push("the description is empty")
  if (description.length > DESCRIPTION_CHARS) problems.push(`the description is ${description.length} characters; two sentences under ${DESCRIPTION_CHARS}`)
  const hashtags = metadata.hashtags.map((h) => h.trim().toLowerCase())
  if (hashtags.length < HASHTAGS[0] || hashtags.length > HASHTAGS[1]) {
    problems.push(`use ${HASHTAGS[0]}–${HASHTAGS[1]} hashtags, not ${hashtags.length}`)
  }
  const bad = hashtags.filter((h) => !/^#[a-z0-9_]+$/.test(h))
  if (bad.length > 0) problems.push(`hashtags are # plus one lowercase word: ${bad.join(", ")}`)
  if (hashtags[0] !== "#shorts") problems.push("start the hashtags with #shorts")
  return { value: { title, alternates, description, hashtags }, problems }
}

export interface PostNotes {
  // the title, description and hashtags you post with
  readonly post: PostText
  // the other titles to A/B test with: the agent's pick and alternates you didn't choose
  readonly alternates: ReadonlyArray<string>
  readonly credit: string | null
  readonly approach: string
  readonly style: string
  readonly durationS: number
}

// The agent's titles other than the one you post with.
export const otherTitles = (metadata: Pick<ShortMetadata, "title" | "alternates">, title: string) =>
  [metadata.title, ...metadata.alternates].filter((t) => t !== title)

// The post text as markdown, kept next to the video in ~/.viral/renders/.
export const postNotes = ({ post, alternates, credit, approach, style, durationS }: PostNotes) =>
  [
    `# ${post.title}`,
    `**Approach:** ${approach} · **Style:** ${style} · **Length:** ${durationS.toFixed(1)}s`,
    `## Title\n\n${post.title}${alternates.length === 0 ? "" : `\n\nAlternates:\n${alternates.map((a) => `- ${a}`).join("\n")}`}`,
    `## Description\n\n${post.description}${credit === null ? "" : `\n\nCredit: ${credit}`}\n\n${post.hashtags.join(" ")}`
  ].join("\n\n") + "\n"
