import type { SetStoryBeat, StoryMap } from "@viral/contracts"
import { SECTION_LIMITS, type Range } from "./section-rules.ts"
import { creatorBriefLine } from "../projects/creator-brief.ts"
import { type BriefVideo, VIDEOS_NOTE, videosSections } from "../projects/videos-brief.ts"
import { beatLine } from "../video-sets/short-story.ts"

// The stage's job and tool contract; how to cut comes from the approach-cut-down and story-arc skills.
export const SECTIONS_PROMPT = `You cut a long video down into one short made only of the creator's own speech, following the
approach-cut-down skill and the story-arc skill below.

1. Read the timed transcript and the story beats. Find the creator's single strongest line for the hook, and the
   stretches that carry the story: the goal, the struggle, the turn, the payoff.
2. Choose sections in playing order (not source order), each with its beat and source seconds from the transcript.
   Use several short sections to jump-cut filler out of a beat. Total ${SECTION_LIMITS.total[0]}–${SECTION_LIMITS.total[1]} seconds.
   Every section is whole sentences: it starts on a sentence's first word and ends on a sentence's last word (only a
   pause over 1.5 s ends a sentence). Never end on a half-answer; if a reply runs long, keep it and cut elsewhere.
   The last section ends on the payoff; the closing question isn't a section.
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
  // a short from several videos: every video (V1 first) with its transcript, excluded ranges and overview sheets,
  // which replace `title`, `channel`, `story`, `excluded`, `sourceSeconds`, `sheets` and `transcript` above
  readonly videos?: ReadonlyArray<SectionsVideo>
  // with several videos: the story beats in them, `source` = position
  readonly beats?: ReadonlyArray<SetStoryBeat>
}

export interface SectionsVideo extends BriefVideo {
  // one line per overview sheet: its file and time range
  readonly sheets: ReadonlyArray<string>
}

const fmt = (t: number) => t.toFixed(1)

// The angle picked for the short, when it came from a proposal.
const angleText = (angle: SectionsBrief["angle"]) =>
  angle === null ? "" : `The angle picked for this short:\n- title: ${angle.title}\n- hook: ${angle.hook}\n- why: ${angle.why}`

// A short from several videos: the videos labelled V1, V2…, each with its ads, sheets and transcript (or an outline
// when they're long, read further with the transcript tools), and the beats across them.
const severalVideosBrief = (brief: SectionsBrief, videos: ReadonlyArray<SectionsVideo>) => {
  const { list, sections, inline } = videosSections(videos.map((v) => ({
    ...v,
    extra: v.sheets.length === 0 ? [] : [`Overview contact sheets (a frame every 5s):\n${v.sheets.join("\n")}`]
  })))
  return [
    creatorBriefLine(brief.creatorBrief),
    VIDEOS_NOTE,
    `Videos:\n${list}`,
    "Each section names its video (`video`: its V number), and its seconds are that video's own; `contact_sheet` and " +
    "`preview_sections` take the V number too. Cutting from one video to another is fine anywhere, but the first time " +
    "a video plays, open on a line that tells the viewer who or where this is (a context cut), so the jump makes sense.",
    angleText(brief.angle),
    brief.beats === undefined || brief.beats.length === 0 ? "" : `Story beats across the videos:\n${brief.beats.map(beatLine).join("\n")}`,
    inline ? "" : "The transcripts are long, so each video has an outline: find moments with `search_transcript` and read around them with `read_transcript`.",
    ...sections
  ].filter((part) => part !== "").join("\n\n")
}

export const buildSectionsBrief = (brief: SectionsBrief) =>
  brief.videos !== undefined && brief.videos.length > 1 ? severalVideosBrief(brief, brief.videos) : [
    creatorBriefLine(brief.creatorBrief),
    `Video: ${brief.title ?? "untitled"}${brief.channel === null ? "" : ` (by ${brief.channel})`}, ${fmt(brief.sourceSeconds)}s long.`,
    angleText(brief.angle),
    brief.story === null
      ? ""
      : `What happens: ${brief.story.summary}\n\nStory beats (source seconds):\n${
        brief.story.beats.map((b) => `- ${b.beat} ${fmt(b.start)}–${fmt(b.end)}s: ${b.summary}`).join("\n")
      }`,
    brief.excluded.length === 0 ? "" : `Excluded ranges (never use): ${brief.excluded.map((r) => `${fmt(r.start)}–${fmt(r.end)}s`).join(", ")}`,
    brief.sheets.length === 0 ? "" : `Overview contact sheets (a frame every 5s):\n${brief.sheets.join("\n")}`,
    `Transcript (source seconds):\n${brief.transcript}`
  ].filter((part) => part !== "").join("\n\n")
