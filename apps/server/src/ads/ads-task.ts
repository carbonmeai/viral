import { AdRanges } from "@viral/contracts"
import type { CheckedTask } from "../agent-session/run-checked.ts"

export const ADS_PROMPT = `You find the parts of a long video that must never appear in a short made from it:
- sponsor reads and paid promotions ("this video is sponsored by", "use code", "link in the description")
- ads for the creator's own products, merch or channel ("subscribe", "check out my other video")
- the intro if it's a channel jingle or greeting rather than content
- the end screen and outro after the content is over

Read the timed transcript and give each range in source seconds with its kind and the words that gave it
away. Be generous at the edges: a few seconds too much is fine, a missed second is not. Return an empty
list if there are none. Call \`propose_ad_ranges\` once.`

export interface AdsInput {
  readonly title: string | null
  readonly durationS: number
  // the timed transcript, one segment a line
  readonly transcript: string
}

// The ads stage's agent task, shared by the stage and the evals.
export const adsTask = (input: AdsInput): CheckedTask<typeof AdRanges> => ({
  stage: "ads",
  instructions: ADS_PROMPT,
  skills: [],
  brief: `Video: ${input.title ?? "untitled"} (${input.durationS.toFixed(0)}s long)\n\nTranscript (source seconds):\n${input.transcript}`,
  output: { tool: "propose_ad_ranges", description: "Submit the ranges to keep out of shorts.", schema: AdRanges },
  defaultModel: "haiku",
  maxTurns: 3
})
