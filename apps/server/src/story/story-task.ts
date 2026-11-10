import { APPROACHES, SINGLE_VIDEO_APPROACHES, StoryMap } from "@viral/contracts"
import { approachSkill } from "../agent-skills/skill-pack.ts"
import type { CheckedTask } from "../agent-session/run-checked.ts"
import { PROPOSALS } from "./story-rules.ts"

export const STORY_PROMPT = `You map a long video's story and propose ways to cut it into a viral short, using the story-arc
skill and the approach skills below.

1. Read the timed transcript. Look at the contact sheets (Read the image files listed) to see what actually
   happens on screen: what's being built, the key objects, the reactions.
2. Map the story into beats (goal → process → setback → fix → result → reaction), each with its source
   seconds, a one-line summary, and the strongest real lines in it, quoted exactly as the transcript has them.
   Cover every stage (all the levels, every attempt), not just the highlights. Favour short, emotional lines
   that make sense with no context.
3. Decide what kind of video this is (the format table in story-arc: stuff happens, people talk…) and propose
   ${PROPOSALS} shorts, one per approach in the catalog, the one whose format suits this kind of video first. For each:
   a working title, the opening hook line, why the approach suits this video in one or two sentences (name its
   weakest radar axis), and the virality radar scores (0–10). The first proposal's \`why\` starts with the kind of
   video and why its format suits it ("A challenge video where the talking is slow: a narrator carries it…").
   Don't write the script or list clips: later stages do that from your beats and the chosen proposal.

Never use anything inside the excluded ranges. Call \`propose_story\` once.`

export interface StoryInput {
  readonly title: string | null
  readonly channel: string | null
  readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number; readonly kind: string }>
  // the overview contact sheets: each file's full path and the source seconds it covers
  readonly sheets: ReadonlyArray<{ readonly file: string; readonly start: number; readonly end: number }>
  // the folder holding them, which the agent may read
  readonly sheetsDir: string | null
  // the timed transcript, one segment a line
  readonly transcript: string
}

// The story stage's agent task, shared by the stage and the evals.
export const storyTask = (input: StoryInput): CheckedTask<typeof StoryMap> => {
  // a ranking needs an entry per video, so a single video's catalog leaves it out
  const catalog = SINGLE_VIDEO_APPROACHES.map((name) => [name, APPROACHES[name]] as const)
    .map(([name, d]) => `- ${name}: hook ${d.hook}, voices ${d.voices}, shape ${d.shape}, format ${d.format}`)
    .join("\n")
  const brief = [
    `Video: ${input.title ?? "untitled"}${input.channel === null ? "" : ` (by ${input.channel})`}`,
    `Approach catalog:\n${catalog}`,
    input.excluded.length === 0
      ? ""
      : `Excluded ranges (ads, sponsor reads, end screens): ${input.excluded.map((r) => `${r.start.toFixed(0)}–${r.end.toFixed(0)}s (${r.kind})`).join(", ")}`,
    input.sheets.length === 0
      ? ""
      : `Contact sheets (a tile every few seconds, labelled mm:ss):\n${input.sheets.map((s) => `- ${s.file}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`).join("\n")}`,
    `Transcript (source seconds):\n${input.transcript}`
  ].filter((part) => part !== "").join("\n\n")
  return {
    stage: "story",
    instructions: STORY_PROMPT,
    skills: ["story-arc", ...SINGLE_VIDEO_APPROACHES.map(approachSkill)],
    brief,
    output: { tool: "propose_story", description: "Submit the story map and the three proposals.", schema: StoryMap },
    defaultModel: null,
    readDirs: input.sheetsDir === null ? [] : [input.sheetsDir],
    maxTurns: 20
  }
}
