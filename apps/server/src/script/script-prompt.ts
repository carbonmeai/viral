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
- Narration with \`skipped: true\`: a line the real line just before it already says ("He said it felt like
  getting electrocuted." after the real "It's like getting electrocuted"). It's voiced, so the narrator's delivery
  flows around the cut, but the short jumps from the real line to the narration after it. Only right after a real
  line, and only when more narration follows.
- Cta: the closing question, only when the brief asks for one: always the last beat, after the payoff, with just the
  \`question\` (one short question for the comments about the viewer, tied to this short: "What's the hottest pepper
  you've ever eaten?"). The narrator says it and adds "Tell us in the comments, and subscribe for more.", over an end
  card. It's outside the approach's word and real-line counts.

Read the whole transcript first and cover the story's stages in order; before each real line, write the set-up it
answers. Every real line is whole sentences: it starts on a sentence's first word and ends on a sentence's last word
(only a pause over 1.5 s ends a sentence), never mid-thought. The story ends on the payoff; the closing question, when
the brief asks for it, is the Cta beat after it, never a Narration line.

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
  // the style ends with a comment question: the script ends with a Cta beat; absent or false = no Cta beat
  readonly closingQuestion?: boolean
  // a narrated ranking: how many entries it counts down (one per video); absent = not a ranking
  readonly ranking?: { readonly entries: number } | null
}

const RANK_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]

// A narrated ranking's countdown, said in the brief so the agent knows the shape the server checks.
export const rankingPart = (entries: number) => {
  const word = (n: number) => RANK_WORDS[n] ?? String(n)
  return [
    `This short is a narrated ranking of ${entries} entries, one per video (approach-narrated-ranking). After a narrated hook that teases #1, count down: every entry's first narrated line starts with "Number ${word(entries)}," then "Number ${word(entries - 1)},", … "Number one," last (the rank as a word; no other line starts with "Number").`,
    "Each entry is its video's mini-story: the shocking before, the care, the reveal, with real numbers from that video. It runs about 20–25 s: about 30–45 narrated words plus 1–2 real lines (whole sentences, from that entry's own video only) where they answer the narrator.",
    "#1's reveal ends the story: after the last narrated line, one real take of 10–25 s from #1's video over the after (lines less than 3 s apart join into one take).",
    "Rank by how dramatic the turnaround is. Videos found for a ranking are already in playing order (V1 first, the last video #1); keep that order unless the transcripts show a clearly stronger #1."
  ].join(" ")
}

// Whether to write the closing question, said last in the brief.
const closingPart = (brief: ScriptBrief) =>
  brief.closingQuestion === true
    ? "This short's style ends with a comment question: after the payoff, end the script with a Cta beat holding one question for the comments (see story-arc's \"The closing question\")."
    : "This short's style has no closing question: don't write a Cta beat."

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
    "Write the script for this short, following the approach skill. Never use anything in a video's excluded ranges. Every real line names its video (`video`: its V number) and gives that video's seconds; introduce each new video with a narrated line the first time it plays.",
    brief.ranking == null ? "" : rankingPart(brief.ranking.entries),
    closingPart(brief)
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
    "Write the script for this video, following the approach skill.",
    closingPart(brief)
  ].filter((part) => part !== "").join("\n\n")
