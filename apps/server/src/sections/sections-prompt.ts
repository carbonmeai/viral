import type { StoryMap } from "@viral/contracts"
import { SECTION_LIMITS, type Range } from "./section-rules.ts"
import { creatorBriefLine } from "../projects/creator-brief.ts"

// The stage's job and tool contract; how to cut comes from the approach-cut-down and story-arc skills.
export const SECTIONS_PROMPT = `You cut a long video down into one short made only of the creator's own speech, following the
approach-cut-down skill and the story-arc skill below.

1. Read the timed transcript and the story beats. Find the creator's single strongest line for the hook, and the
   stretches that carry the story: the goal, the struggle, the turn, the payoff.
2. Choose sections in playing order (not source order), each with its beat and source seconds from the transcript.
   Use several short sections to jump-cut filler out of a beat. Total ${SECTION_LIMITS.total[0]}–${SECTION_LIMITS.total[1]} seconds.
3. Look at what's on screen: the overview contact sheets (Read the files listed), and \`contact_sheet\` for a frame
   every second around a moment. Set framing "blur" for a section whose frame shouldn't be cropped (a screen share,
   a wide shot), and cropX when the speaker sits off-centre.
4. Write the hook text: the open loop in ${SECTION_LIMITS.hookWords} words or fewer, readable with the sound off.
5. Before submitting, call \`preview_sections\` with your plan: it checks it and draws each section's first frame.
   Read the storyboard and fix anything that doesn't work, then call \`propose_sections\` once.

Never use anything inside the excluded ranges.`

export interface SectionsBrief {
  // the creator's brief for the short ("what should it achieve?"), put first; null or absent = none
  readonly creatorBrief?: string | null
  readonly title: string | null
  readonly channel: string | null
  // the story stage's proposal this short was made from, when it was
  readonly angle: { readonly title: string; readonly hook: string; readonly why: string } | null
  readonly story: StoryMap | null
  readonly excluded: ReadonlyArray<Range>
  readonly sourceSeconds: number
  // one line per overview sheet: its file and time range
  readonly sheets: ReadonlyArray<string>
  // the source's timed transcript
  readonly transcript: string
}

const fmt = (t: number) => t.toFixed(1)

export const buildSectionsBrief = (brief: SectionsBrief) =>
  [
    creatorBriefLine(brief.creatorBrief),
    `Video: ${brief.title ?? "untitled"}${brief.channel === null ? "" : ` (by ${brief.channel})`}, ${fmt(brief.sourceSeconds)}s long.`,
    brief.angle === null
      ? ""
      : `The angle picked for this short:\n- title: ${brief.angle.title}\n- hook: ${brief.angle.hook}\n- why: ${brief.angle.why}`,
    brief.story === null
      ? ""
      : `What happens: ${brief.story.summary}\n\nStory beats (source seconds):\n${
        brief.story.beats.map((b) => `- ${b.beat} ${fmt(b.start)}–${fmt(b.end)}s: ${b.summary}`).join("\n")
      }`,
    brief.excluded.length === 0 ? "" : `Excluded ranges (never use): ${brief.excluded.map((r) => `${fmt(r.start)}–${fmt(r.end)}s`).join(", ")}`,
    brief.sheets.length === 0 ? "" : `Overview contact sheets (a frame every 5s):\n${brief.sheets.join("\n")}`,
    `Transcript (source seconds):\n${brief.transcript}`
  ].filter((part) => part !== "").join("\n\n")
