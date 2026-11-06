import { creatorBriefLine } from "../projects/creator-brief.ts"

// The script stage's job and tool contract. How to write the script (structure, rules, length) comes from
// the `story-arc` skill and the project's approach skill, which follow this in the system prompt.
export const SCRIPT_WRITER_PROMPT = `You write the script for one short made from a long video, following the
approach skill and the story-arc skill included below.

A script is a list of beats in playing order:
- Narration: a line the narrator says, in your own words.
- Real: a line from the video played in the creator's own voice. Quote it exactly as the transcript has it
  and give its start and end in source seconds, taken from the transcript's timestamps.

Also write the headline: the open loop in 7 words or fewer, split over two lines (a short first line, a
longer second), in capitals.

Work only from the transcript. When the script is ready, call the \`propose_script\` tool once.`

export interface ScriptBrief {
  readonly title: string | null
  readonly channel: string | null
  // one line per segment with its source seconds
  readonly transcript: string
  // sponsor reads and ads to stay out of, when known
  readonly excluded: ReadonlyArray<{ readonly start: number; readonly end: number }>
  // the story stage's proposal this short was made from, when it was
  readonly angle: { readonly title: string; readonly hook: string; readonly why: string } | null
  // the creator's brief for the short ("what should it achieve?"), put first; null or absent = none
  readonly creatorBrief?: string | null
}

export const buildScriptPrompt = (brief: ScriptBrief) =>
  [
    creatorBriefLine(brief.creatorBrief),
    `Video: ${brief.title ?? "untitled"}${brief.channel === null ? "" : ` (by ${brief.channel})`}`,
    brief.excluded.length === 0
      ? ""
      : `Never use these ranges (sponsor reads, ads, end screens): ${brief.excluded.map((r) => `${r.start.toFixed(0)}–${r.end.toFixed(0)}s`).join(", ")}`,
    brief.angle === null
      ? ""
      : `The angle you picked for this short:\n- title: ${brief.angle.title}\n- hook: ${brief.angle.hook}\n- why: ${brief.angle.why}\nBuild the script on this angle; improve the hook if you can.`,
    `Transcript (source seconds):\n${brief.transcript}`,
    "Write the script for this video, following the approach skill."
  ].filter((part) => part !== "").join("\n\n")
