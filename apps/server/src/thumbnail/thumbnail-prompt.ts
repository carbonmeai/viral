import type { SetStoryBeat, StoryMap } from "@viral/contracts"
import type { Range } from "./thumbnail-rules.ts"
import { creatorBriefLine } from "../projects/creator-brief.ts"
import { videoLabel } from "../projects/videos-brief.ts"
import { beatLine } from "../video-sets/short-story.ts"

// The stage's job and tool contract; what makes a good thumbnail comes from the thumbnails skill.
export const THUMBNAIL_PROMPT = `You make the thumbnail for a finished short, following the thumbnails skill below. The default
layout is bold: a saturated colour gradient, the hero object and a reaction face lifted out of their frames with
thick outlines (the face big, overlapping the hero), 2–5 curiosity words at the top, and a red arrow to the hero or
one emoji. You choose the moments, the crops, the colours and the words; the server places everything. Use layout
"classic" (a blurred frame behind framed insets) only when the video has no strong reaction face.

1. From the story beats and the overview contact sheets (Read the image files listed; each tile is labelled mm:ss),
   find the hero object's best moment and the strongest, most extreme reaction face.
2. Overview sheets show a frame every 5 seconds. Call \`contact_sheet\` with a short range around each moment (up to
   60s) for a frame every second, and Read it to pick the exact second: the peak of the expression.
3. Crops are fractions of the frame: [left, top, right, bottom], each 0–1. Crop the face to head and shoulders, and
   keep other people and objects out of it, since the cut-out keeps what's attached. The circle's x, y and r are
   fractions of the cropped hero image.
4. Call \`preview_thumbnail\` with your thumbnail and Read the image it returns. Fix anything that doesn't read at phone
   size, then preview again.
5. Call \`propose_thumbnail\` once with the thumbnail you previewed last.`

export interface ThumbnailBrief {
  // the creator's brief for the short ("what should it achieve?"), put first; null or absent = none
  readonly creatorBrief?: string | null
  readonly title: string
  readonly alternates: ReadonlyArray<string>
  readonly video: { readonly title: string | null; readonly channel: string | null; readonly width: number; readonly height: number }
  // what's said in the short, line by line
  readonly lines: ReadonlyArray<string>
  readonly story: StoryMap | null
  readonly excluded: ReadonlyArray<Range>
  readonly sourceSeconds: number
  readonly sheets: ReadonlyArray<string>
  // a short from several videos: every video (V1 first) with its frame size, excluded ranges and overview sheets,
  // which replace `video`, `story`, `excluded`, `sourceSeconds` and `sheets` above
  readonly videos?: ReadonlyArray<ThumbnailBriefVideo>
  // with several videos: the story beats in them, `source` = position
  readonly beats?: ReadonlyArray<SetStoryBeat>
}

export interface ThumbnailBriefVideo {
  readonly title: string | null
  readonly channel: string | null
  readonly seconds: number
  readonly width: number
  readonly height: number
  readonly excluded: ReadonlyArray<Range & { readonly kind?: string }>
  // one line per overview sheet: its file and time range
  readonly sheets: ReadonlyArray<string>
}

// The note a brief over several videos carries: the hero and the face may come from different videos.
export const THUMBNAIL_VIDEOS_NOTE = `This short draws from several videos, labelled V1, V2… in the creator's order. The hero, the
face and (classic) the background can each come from any of them: give each its video (\`video\`: its V number; leave it
out for V1). Its time and crop are in that video's own seconds and frame. \`contact_sheet\` and \`preview_thumbnail\`
take the same. Pick the strongest picture across all of them, not just V1.`

const fmt = (t: number) => t.toFixed(1)

export const buildThumbnailBrief = (brief: ThumbnailBrief) => {
  const videos = brief.videos !== undefined && brief.videos.length > 1 ? brief.videos : null
  if (videos !== null) {
    return [
      creatorBriefLine(brief.creatorBrief),
      `The short: "${brief.title}"${brief.alternates.length === 0 ? "" : ` (also tried: ${brief.alternates.map((a) => `"${a}"`).join(", ")})`}`,
      THUMBNAIL_VIDEOS_NOTE,
      `Videos:\n${videos.map((v, i) => `- ${videoLabel(i + 1, v)}, frames ${v.width}×${v.height}`).join("\n")}`,
      brief.lines.length === 0 ? "" : `What the short says:\n${brief.lines.join("\n")}`,
      brief.beats === undefined || brief.beats.length === 0 ? "" : `Story beats across the videos:\n${brief.beats.map(beatLine).join("\n")}`,
      ...videos.map((v, i) => [
        `## ${videoLabel(i + 1, v)}`,
        v.excluded.length === 0 ? "" : `Excluded ranges in V${i + 1} (never use): ${v.excluded.map((r) => `${fmt(r.start)}–${fmt(r.end)}s`).join(", ")}`,
        v.sheets.length === 0 ? `V${i + 1} has no overview contact sheets; use \`contact_sheet\` with \`video: ${i + 1}\`.` : `Overview contact sheets of V${i + 1} (a frame every 5s):\n${v.sheets.join("\n")}`
      ].filter((part) => part !== "").join("\n\n"))
    ].filter((part) => part !== "").join("\n\n")
  }
  return [
    creatorBriefLine(brief.creatorBrief),
    `The short: "${brief.title}"${brief.alternates.length === 0 ? "" : ` (also tried: ${brief.alternates.map((a) => `"${a}"`).join(", ")})`}`,
    `From: ${brief.video.title ?? "untitled"}${brief.video.channel === null ? "" : ` by ${brief.video.channel}`}, ` +
    `${fmt(brief.sourceSeconds)}s long, frames ${brief.video.width}×${brief.video.height}.`,
    brief.lines.length === 0 ? "" : `What the short says:\n${brief.lines.join("\n")}`,
    brief.story === null
      ? ""
      : `Story beats (source seconds):\n${brief.story.beats.map((b) => `- ${b.beat} ${fmt(b.start)}–${fmt(b.end)}s: ${b.summary}`).join("\n")}`,
    brief.excluded.length === 0 ? "" : `Excluded ranges (never use): ${brief.excluded.map((r) => `${fmt(r.start)}–${fmt(r.end)}s`).join(", ")}`,
    brief.sheets.length === 0 ? "" : `Overview contact sheets (a frame every 5s):\n${brief.sheets.join("\n")}`
  ].filter((part) => part !== "").join("\n\n")
}
