import { creatorBriefLine } from "../projects/creator-brief.ts"
import type { SetStoryBeat } from "@viral/contracts"
import { type BriefVideo, VIDEOS_NOTE, videosSections } from "../projects/videos-brief.ts"
import { beatLine } from "../video-sets/short-story.ts"

// The script stage's job and tool contract. How to write the script (structure, rules, length) comes from
// the `story-arc` skill and the project's approach skill, which follow this in the system prompt.
export const SCRIPT_WRITER_PROMPT = `You write the script for one short made from a long video, following the
approach skill and the story-arc skill included below.

A script is a list of beats in playing order:
- Narration: a line the narrator says, in your own words.
- Real: a line from the video played in the creator's own voice. Quote it exactly as the transcript has it
  and give its start and end in source seconds, taken from the transcript's timestamps.

Read the whole transcript first and cover the story's stages in order; before each real line, write the set-up it
answers. Every real line is whole sentences: it starts on a sentence's first word and ends on a sentence's last word
(only a pause over 1.5 s ends a sentence), never mid-thought. The script ends on the payoff; the closing question is
not one of its beats.

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
  // a short from several videos: every video (V1 first) with its transcript and excluded ranges, which replace
  // `title`, `channel`, `transcript` and `excluded` above; absent or one video = a single-video short
  readonly videos?: ReadonlyArray<BriefVideo>
  // with several videos: the story beats in them (from the set's story, or each video's own), `source` = position
  readonly beats?: ReadonlyArray<SetStoryBeat>
}

const angleLine = (angle: ScriptBrief["angle"]) =>
  angle === null
    ? ""
    : `The angle you picked for this short:\n- title: ${angle.title}\n- hook: ${angle.hook}\n- why: ${angle.why}\nBuild the script on this angle; improve the hook if you can.`

// The brief for a short from several videos: the videos, each one's ads and transcript (whole, or an outline to
// read further with the transcript tools).
const severalVideosPrompt = (brief: ScriptBrief, videos: ReadonlyArray<BriefVideo>) => {
  const { list, sections, inline } = videosSections(videos)
  return [
    creatorBriefLine(brief.creatorBrief),
    VIDEOS_NOTE,
    `Videos:\n${list}`,
    angleLine(brief.angle),
    brief.beats === undefined || brief.beats.length === 0 ? "" : `Story beats across the videos:\n${brief.beats.map(beatLine).join("\n")}`,
    inline ? "" : "The transcripts are long, so each video has an outline: find lines with `search_transcript` and read around them with `read_transcript` before you quote them.",
    ...sections,
    "Write the script for this short, following the approach skill. Never use anything in a video's excluded ranges. Every real line names its video (`video`: its V number) and gives that video's seconds; introduce each new video with a narrated line the first time it plays."
  ].filter((part) => part !== "").join("\n\n")
}

export const buildScriptPrompt = (brief: ScriptBrief) =>
  brief.videos !== undefined && brief.videos.length > 1 ? severalVideosPrompt(brief, brief.videos) : [
    creatorBriefLine(brief.creatorBrief),
    `Video: ${brief.title ?? "untitled"}${brief.channel === null ? "" : ` (by ${brief.channel})`}`,
    brief.excluded.length === 0
      ? ""
      : `Never use these ranges (sponsor reads, ads, end screens): ${brief.excluded.map((r) => `${r.start.toFixed(0)}–${r.end.toFixed(0)}s`).join(", ")}`,
    angleLine(brief.angle),
    `Transcript (source seconds):\n${brief.transcript}`,
    "Write the script for this video, following the approach skill."
  ].filter((part) => part !== "").join("\n\n")
