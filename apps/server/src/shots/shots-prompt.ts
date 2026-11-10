import type { ApproachName, SetStoryBeat, StoryMap, TranscriptWord } from "@viral/contracts"
import type { Range, ShotDraft } from "./shot-rules.ts"
import { creatorBriefLine } from "../projects/creator-brief.ts"
import { type BriefVideo, VIDEOS_NOTE, videosSections } from "../projects/videos-brief.ts"
import { beatLine } from "../video-sets/short-story.ts"

// The stage's job and tool contract; how to plan shots comes from the narrated-shots skill.
export const SHOTS_PROMPT = `You plan the b-roll for a narrated short: which moment of the long video plays under each part
of the voiceover, following the narrated-shots skill below.

1. Read the voiceover's numbered words and the story beats. Find the footage for each line in the contact sheets
   (Read the image files listed; each tile is labelled mm:ss): the actual thing each line names (the pepper, the
   card with the number, the face).
2. Overview sheets show a frame every 5 seconds. Before you pick a shot's source second, call \`contact_sheet\` with
   a short range around the moment (up to 60s) for a frame every second, and Read the sheet it returns.
3. Anchor every shot to the voiceover word it starts on. The real lines are already placed: the narration pauses
   after the word shown, plays the clip, and resumes on the next word, where a new shot must start.
4. Add one or two markers (a circle or arrow on the hero object, or a short label) when they help.
5. Pick 5–10 key words of the narration for the captions to colour (the tastes, the hero object, the twist), each
   with a colour that fits its meaning: spicy red, cold cyan, sour green, sweet pink, savory orange. Use "accent"
   when no colour fits.
6. Before submitting, call \`preview_shots\` with the whole plan. It lists problems to fix, or draws every shot's
   first frame: Read the storyboard and fix any shot whose frame doesn't show its words (a wide shot where a
   close-up was meant, the wrong person, a frame before the action starts, a transition: about a third of picks
   from coarse sheets land on one). Preview again after big changes.

Never use footage inside the excluded ranges. Call \`propose_shots\` once with the whole plan.`

export interface ShotsBrief {
  // the creator's brief for the short ("what should it achieve?"), put first; null or absent = none
  readonly creatorBrief?: string | null
  readonly title: string | null
  readonly approach: ApproachName
  readonly framing: "band" | "full"
  // the style's average shot length
  readonly shotSeconds: number
  readonly words: ReadonlyArray<TranscriptWord>
  // the last voiceover word of each narration beat
  readonly narrationEnds: ReadonlyArray<number>
  readonly inserts: ShotDraft["inserts"]
  readonly outro: ShotDraft["outro"]
  readonly story: StoryMap | null
  readonly excluded: ReadonlyArray<Range>
  readonly sourceSeconds: number
  // one line per overview sheet: its file and time range
  readonly sheets: ReadonlyArray<string>
  // the source's timed transcript, for finding what was said when
  readonly transcript: string
  // a short from several videos: every video (V1 first) with its transcript, excluded ranges and overview sheets,
  // which replace `title`, `story`, `excluded`, `sourceSeconds`, `sheets` and `transcript` above
  readonly videos?: ReadonlyArray<ShotsVideo>
  // with several videos: the story beats in them, `source` = position
  readonly beats?: ReadonlyArray<SetStoryBeat>
}

export interface ShotsVideo extends BriefVideo {
  // one line per overview sheet: its file and time range
  readonly sheets: ReadonlyArray<string>
}

// "V2 " before a clip's times in a short from several videos; nothing in a single-video short
const videoOf = (several: boolean, source: number | undefined) => several ? `V${(source ?? 0) + 1} ` : ""

const fmt = (t: number) => t.toFixed(1)

export const buildShotsBrief = (brief: ShotsBrief) => {
  const videos = brief.videos !== undefined && brief.videos.length > 1 ? brief.videos : null
  const several = videos !== null
  const lines: Array<string> = []
  let from = 0
  brief.narrationEnds.forEach((end, b) => {
    const words = brief.words.slice(from, end + 1).map((w, i) => `${from + i}:${w.w}@${w.s.toFixed(2)}`).join(" ")
    lines.push(`Narration ${b + 1} (words ${from}–${end}): ${words}`)
    for (const insert of brief.inserts.filter((i) => i.afterWord === end)) {
      lines.push(`  → REAL after word ${end} "${insert.afterWordText}": "${insert.quote}" (${videoOf(several, insert.source)}${fmt(insert.start)}–${fmt(insert.end)}s); the narration resumes on word ${end + 1}`)
    }
    from = end + 1
  })
  if (from < brief.words.length) {
    lines.push(`(more words ${from}–${brief.words.length - 1}): ${brief.words.slice(from).map((w, i) => `${from + i}:${w.w}`).join(" ")}`)
  }
  for (const clip of brief.outro) lines.push(`  → OUTRO after the narration: "${clip.quote}" (${videoOf(several, clip.source)}${fmt(clip.start)}–${fmt(clip.end)}s)`)

  const framing = `Approach: ${brief.approach}. Framing: ${brief.framing}` +
    (brief.framing === "full" ? " (the 16:9 footage is cropped to fill 9:16; set cropX when the subject is off-centre, fit for graphics)." : ".")
  const pace = `Aim for shots of about ${brief.shotSeconds}s on average; none longer than 3s.`
  const voiceover = `Voiceover words (index:word@seconds):\n${lines.join("\n")}`

  if (videos !== null) {
    const { list, sections, inline } = videosSections(videos.map((v) => ({
      ...v,
      extra: v.sheets.length === 0 ? [] : [`Overview contact sheets (a frame every 5s):\n${v.sheets.join("\n")}`]
    })))
    return [
      creatorBriefLine(brief.creatorBrief),
      VIDEOS_NOTE,
      `Videos:\n${list}`,
      `${framing} Each shot names its video (\`video\`: its V number); \`contact_sheet\` takes it too. The first time a video plays, the narration should be introducing it.`,
      pace,
      voiceover,
      brief.beats === undefined || brief.beats.length === 0 ? "" : `Story beats across the videos:\n${brief.beats.map(beatLine).join("\n")}`,
      inline ? "" : "The transcripts are long, so each video has an outline: find moments with `search_transcript` and read around them with `read_transcript`.",
      ...sections
    ].filter((part) => part !== "").join("\n\n")
  }

  const story = brief.story === null
    ? ""
    : `Story beats (source seconds):\n${brief.story.beats.map((b) => `- ${b.beat} ${fmt(b.start)}–${fmt(b.end)}s: ${b.summary}`).join("\n")}`
  return [
    creatorBriefLine(brief.creatorBrief),
    `Video: ${brief.title ?? "untitled"} (${fmt(brief.sourceSeconds)}s long). ${framing}`,
    pace,
    voiceover,
    story,
    brief.excluded.length === 0 ? "" : `Excluded ranges (never show): ${brief.excluded.map((r) => `${fmt(r.start)}–${fmt(r.end)}s`).join(", ")}`,
    brief.sheets.length === 0 ? "" : `Overview contact sheets (a frame every 5s):\n${brief.sheets.join("\n")}`,
    `Source transcript (source seconds):\n${brief.transcript}`
  ].filter((part) => part !== "").join("\n\n")
}
