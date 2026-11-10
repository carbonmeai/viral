import { RANKING_LIMITS, rankingSeconds as plannedSeconds, type Transcript } from "@viral/contracts"
import { creatorBriefLine } from "../projects/creator-brief.ts"
import { type BriefVideo, videosSections } from "../projects/videos-brief.ts"
import { sentencesOf } from "../transcribe/sentences.ts"

// The stage's job and tool contract; what makes a good ranking comes from the approach-ranking skill.
export const momentsPrompt = (maxSeconds: number, entries: number) => {
  const L = RANKING_LIMITS
  return `You pick the moments of a ranking short ("Ranking Animal Comebacks"), following the approach-ranking skill below.
Each of the short's videos becomes one entry: a little story told in its own clips, with their own sound.

1. Read each video's sentences (each line is one whole sentence: "[V2 12.3–15.8] text") and look at its overview
   contact sheets (Read the files listed). Find its before (the animal at its worst), its care (vet, IV, bath, shave,
   feeding) and its after (healthy and happy). Every video gets an entry.
2. Call \`contact_sheet\` for a frame every second around each moment, and Read it to place the shot exactly.
3. Rank the entries by how dramatic the turnaround is: #1 is the most dramatic. Give each a label of about 20
   characters (at most ${L.labelChars}) and one emoji, and write the title: a lead ("Ranking Animal ") and an accent
   ("Comebacks", drawn in red), ${L.titleChars} characters at most together.
4. Each entry gets ${L.shots[0]} shots in order, before → care → after, planned about 3.5 s / 3 s / 4.5 s; #1 gets ${L.shots[1]}
   shots and about 20–25 s, and is the longest entry. Plan short: Viral moves every cut to whole sentences, which
   makes shots longer. The whole ranking must stay within ${maxSeconds.toFixed(0)} s once snapped; aim for about
   ${Math.min(maxSeconds, plannedSeconds(entries)).toFixed(0)} s.
5. Shots start ${L.minStart} s or later and stay out of the excluded ranges (ads, intros, end screens). Leave \`framing\` out
   unless the one Viral detects is wrong for that moment ("window": landscape footage in a 4:3 window; "fill":
   upright phone footage fills the screen). Never zoom in to hide a video's own subtitles.
6. Call \`preview_moments\` with the whole ranking: it snaps the cuts to whole sentences, checks everything and draws
   every shot's first and last frame. Read the storyboard and the frames: both ends of every shot must show the
   entry's animal in that shot's state (not another animal, not a recap, not the before replayed in the after). Fix
   what's wrong and preview again.
7. Call \`propose_moments\` once with the ranking you previewed last. When Viral says a shot's first and last frames
   look like different scenes, Read both; if both are right, set \`framesChecked: true\` on that shot.

Each entry names its video (\`video\`: its V number) and uses that video's own seconds. Leave \`order\` out: Viral
shuffles the play order with #1 last.`
}

export interface MomentsVideo extends BriefVideo {
  // its part in the idea from the research shortlist ("#3: the matted dog") and the moments it was expected to have
  readonly part: string | null
  readonly expected: ReadonlyArray<{ readonly label: string; readonly at: number | null }>
  // the framing Viral detected for most of it
  readonly framing: "window" | "fill" | null
  // one line per overview sheet: its file and time range
  readonly sheets: ReadonlyArray<string>
}

export interface MomentsBrief {
  // the creator's brief for the short ("what should it achieve?"); null = none
  readonly creatorBrief: string | null
  // the idea a research found the videos for, when it was
  readonly idea: string | null
  readonly workingTitle: string
  readonly maxSeconds: number
  readonly videos: ReadonlyArray<MomentsVideo>
}

// A transcript re-cut into whole sentences (a pause over 1.5 s ends one), so every line is a place a cut may fall.
const bySentence = (transcript: Transcript): Transcript => ({
  ...transcript,
  segments: sentencesOf(transcript.segments.flatMap((s) => s.words)).map((s) => ({ start: s.start, end: s.end, text: s.text, words: [] }))
})

const FRAMING = { window: "landscape (a 4:3 window over a blurred fill)", fill: "upright: it fills the screen" } as const

export const buildMomentsBrief = (brief: MomentsBrief) => {
  const { list, sections } = videosSections(brief.videos.map((v) => ({
    ...v,
    transcript: v.transcript === null ? null : bySentence(v.transcript),
    extra: [
      v.part === null ? "" : `Its part in the idea: ${v.part}`,
      v.expected.length === 0
        ? ""
        : `Moments the research expected (a guess from its description): ${v.expected.map((m) => `${m.label}${m.at === null ? "" : ` ~${m.at.toFixed(0)}s`}`).join(", ")}`,
      v.framing === null ? "" : `Mostly ${FRAMING[v.framing]}.`,
      v.sheets.length === 0 ? "" : `Overview contact sheets (a frame every 5s):\n${v.sheets.join("\n")}`
    ].filter((line) => line !== "")
  })))
  return [
    creatorBriefLine(brief.creatorBrief),
    brief.idea === null ? "" : `The idea these videos were found for: ${brief.idea}`,
    `Working title: ${brief.workingTitle}. ${brief.videos.length} videos, so ${brief.videos.length} entries; within ${brief.maxSeconds.toFixed(0)} s.`,
    `Videos:\n${list}`,
    "Every timed line is one whole sentence in that video's own seconds. A cut on a line's start or end needs no moving.",
    ...sections
  ].filter((part) => part !== "").join("\n\n")
}
