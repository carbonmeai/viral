import { ApproachName, APPROACHES, ProposedSetStory, type Transcript } from "@viral/contracts"
import { approachSkill } from "../agent-skills/skill-pack.ts"
import type { AgentTool } from "../agent-session/agent-session.ts"
import type { CheckedTask } from "../agent-session/run-checked.ts"
import { PROPOSALS } from "../story/story-rules.ts"
import { fullText, INLINE_BUDGET, OUTLINE_EVERY, outline, videoLabel } from "../projects/videos-brief.ts"

export const SET_STORY_PROMPT = `You look across several videos the creator put together and propose shorts that use them
together, using the cross-video-story and story-arc skills and the approach skills below.

The videos are labelled V1, V2… in the order the creator gave them. Every timed line is "[V2 724.3–726.1] text": the
video, then seconds in that video. Times are always in that video's own seconds.

1. Read the creator's brief first: it says why these videos belong together and what the shorts should achieve.
2. Read each video's transcript (or its outline, then \`search_transcript\` and \`read_transcript\` for the parts you
   need), and look at the contact sheets (Read the image files listed) to see what happens on screen.
3. Map the story across the videos into beats. Each beat is in one video (\`video\`: its V number) with that video's
   seconds, a one-line summary, and the strongest real lines in it, quoted exactly as that video's transcript has
   them, with the time they're said.
4. Give each video a one-line summary of what it brings to the set.
5. Propose ${PROPOSALS} shorts, one per approach in the catalog, best first. Each one uses at least two of the videos
   (\`videos\`: their V numbers) and gets a working title, the opening hook line, why it works across these videos in
   one or two sentences (name its weakest radar axis), and the virality radar scores (0–10). Don't write the script
   or list clips: later stages do that from your beats and the chosen proposal.

Never use anything inside a video's excluded ranges. Never put a quote in the wrong video. Call \`propose_set_story\`
once.`

export interface SetStoryVideo {
  readonly title: string | null
  readonly channel: string | null
  readonly seconds: number
  readonly transcript: Transcript | null
  readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number; readonly kind: string }>
  // the overview contact sheets: each file's full path and the seconds it covers
  readonly sheets: ReadonlyArray<{ readonly file: string; readonly start: number; readonly end: number }>
  // the video's own story summary, when it has been mapped on its own
  readonly storySummary: string | null
}

export interface SetStoryInput {
  // why the videos belong together; required for a set
  readonly brief: string
  readonly videos: ReadonlyArray<SetStoryVideo>
  // folders the agent may read (each video's contact sheets)
  readonly readDirs: ReadonlyArray<string>
  readonly tools: ReadonlyArray<AgentTool>
}

// The set-story stage's agent task, shared by the stage and its tests.
export const setStoryTask = (input: SetStoryInput): CheckedTask<typeof ProposedSetStory> => {
  const catalog = Object.entries(APPROACHES)
    .map(([name, d]) => `- ${name}: hook ${d.hook}, voices ${d.voices}, shape ${d.shape}, format ${d.format}`)
    .join("\n")
  const total = input.videos.reduce((n, v) => n + (v.transcript === null ? 0 : fullText(1, v.transcript).length), 0)
  const inline = total <= INLINE_BUDGET
  const perVideo = input.videos.map((video, i) => {
    const number = i + 1
    return [
      `## ${videoLabel(number, video)}`,
      video.storySummary === null ? "" : `Its own story: ${video.storySummary}`,
      video.excluded.length === 0
        ? ""
        : `Excluded ranges in V${number} (ads, sponsor reads, end screens): ${video.excluded.map((r) => `${r.start.toFixed(0)}–${r.end.toFixed(0)}s (${r.kind})`).join(", ")}`,
      video.sheets.length === 0
        ? ""
        : `Contact sheets of V${number} (a tile every few seconds, labelled mm:ss):\n${video.sheets.map((s) => `- ${s.file}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`).join("\n")}`,
      video.transcript === null
        ? `V${number} has no transcript.`
        : inline
        ? `Transcript of V${number}:\n${fullText(number, video.transcript)}`
        : `Outline of V${number} (a line about every ${OUTLINE_EVERY}s; read the rest with read_transcript):\n${outline(number, video.transcript)}`
    ].filter((part) => part !== "").join("\n\n")
  })
  const brief = [
    `The creator's brief for these videos: ${input.brief.trim()}`,
    `Videos:\n${input.videos.map((v, i) => `- ${videoLabel(i + 1, v)}`).join("\n")}`,
    `Approach catalog:\n${catalog}`,
    ...perVideo
  ].join("\n\n")
  return {
    stage: "set-story",
    instructions: SET_STORY_PROMPT,
    skills: ["cross-video-story", "story-arc", ...ApproachName.literals.map(approachSkill)],
    brief,
    output: {
      tool: "propose_set_story",
      description: "Submit the story across the videos and the three proposals.",
      schema: ProposedSetStory
    },
    defaultModel: null,
    readDirs: input.readDirs,
    tools: input.tools,
    maxTurns: 30
  }
}
