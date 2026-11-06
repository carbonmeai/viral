import type { ShortMetadata } from "@viral/contracts"
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
  readonly metadata: ShortMetadata
  readonly credit: string | null
  readonly approach: string
  readonly style: string
  readonly durationS: number
}

// The post text as markdown, kept next to the video in ~/.viral/renders/.
export const postNotes = ({ metadata, credit, approach, style, durationS }: PostNotes) =>
  [
    `# ${metadata.title}`,
    `**Approach:** ${approach} · **Style:** ${style} · **Length:** ${durationS.toFixed(1)}s`,
    `## Title\n\n${metadata.title}\n\nAlternates:\n${metadata.alternates.map((a) => `- ${a}`).join("\n")}`,
    `## Description\n\n${metadata.description}${credit === null ? "" : `\n\nCredit: ${credit}`}\n\n${metadata.hashtags.join(" ")}`
  ].join("\n\n") + "\n"
