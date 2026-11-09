import { ShortMetadata } from "@viral/contracts"
import type { CheckedTask } from "../agent-session/run-checked.ts"
import { creatorBriefLine } from "../projects/creator-brief.ts"
import { videoLabel } from "../projects/videos-brief.ts"

export const METADATA_PROMPT = `You write what a finished short is posted with, following the short-metadata skill below: a title,
two or three alternate titles, a two-sentence description and hashtags. Work only from what the short says and the
video details given. Call \`propose_metadata\` once.`

export interface MetadataInput {
  readonly title: string | null
  readonly channel: string | null
  // the story's one-paragraph summary, when there is one
  readonly summary: string | null
  readonly approach: string
  readonly durationS: number
  readonly workingTitle: string
  // what the short says, one line each ("NARRATOR: …", "REAL: \"…\"")
  readonly lines: string
  // the creator's brief for the short ("what should it achieve?"), put first; null or absent = none
  readonly creatorBrief?: string | null
  // a short from several videos: each one (V1 first) with what happens in it, which replace `title`, `channel` and
  // `summary` above; absent or one video = a single-video short
  readonly videos?: ReadonlyArray<{
    readonly title: string | null
    readonly channel: string | null
    readonly seconds: number
    readonly summary: string | null
  }>
  // with several videos: what joins them (the set's story summary), when known
  readonly acrossVideos?: string | null
  // a ranking short: how many entries (its title reads "Top 5 …", its description ends "Wait for #1.")
  readonly ranking?: { readonly entries: number } | null
}

// What a ranking's post text needs (approach-ranking skill).
const rankingLines = (entries: number) =>
  `This short is a ranking of ${entries}. Title it like "Top ${entries} Animal Comebacks (Before & After)" (under 40 characters), ` +
  `with alternates that tease #1 without saying what it is ("#1 Was Lying Down To Die"). The description is two sentences ` +
  `with the real numbers, no spoiled ending, and ends with "Wait for #1." The channels are credited for you; don't list them.`

const videoLines = (input: MetadataInput) => {
  const videos = input.videos
  if (videos === undefined || videos.length < 2) {
    return [
      `Video: ${input.title ?? "untitled"}${input.channel === null ? "" : ` (by ${input.channel})`}`,
      input.summary === null ? "" : `What happens: ${input.summary}`
    ]
  }
  return [
    `The short draws from ${videos.length} videos:\n${
      videos.map((v, i) => `- ${videoLabel(i + 1, v)}${v.summary === null ? "" : `: ${v.summary}`}`).join("\n")
    }`,
    input.acrossVideos === undefined || input.acrossVideos === null ? "" : `What joins them: ${input.acrossVideos}`
  ]
}

// The metadata stage's agent task, shared by the stage and the evals.
export const metadataTask = (input: MetadataInput): CheckedTask<typeof ShortMetadata> => ({
  stage: "metadata",
  instructions: METADATA_PROMPT,
  skills: input.ranking === undefined || input.ranking === null ? ["short-metadata"] : ["short-metadata", "approach-ranking"],
  brief: [
    creatorBriefLine(input.creatorBrief),
    input.ranking === undefined || input.ranking === null ? "" : rankingLines(input.ranking.entries),
    ...videoLines(input),
    `The short (${input.approach}, ${input.durationS.toFixed(0)}s), working title "${input.workingTitle}":\n${input.lines}`
  ].filter((part) => part !== "").join("\n\n"),
  output: { tool: "propose_metadata", description: "Submit the title, alternates, description and hashtags.", schema: ShortMetadata },
  defaultModel: "haiku",
  maxTurns: 3
})
