import {
  looksLikeRanking,
  MAX_RESEARCH_BACKUPS,
  MAX_RESEARCH_VIDEO_SECONDS,
  PREFERRED_RESEARCH_VIDEO_SECONDS,
  ProposedShortlist,
  rankingSeconds,
  RESEARCH_LOOKUPS,
  RESEARCH_SEARCHES,
  type Research,
  type Shortlist
} from "@viral/contracts"
import type { AgentTool } from "../agent-session/agent-session.ts"
import type { CheckedTask } from "../agent-session/run-checked.ts"
import { clock } from "./youtube-values.ts"

export const RESEARCH_PROMPT = `You find the YouTube videos a short will be made from, using the finding-source-videos skill.

The creator's idea is below, with how many videos they want and how long the short should be. You only ever see text
about videos: search_youtube gives each result's title, channel, length and views; video_details gives one video's
description, chapter list and the start of its captions. Nothing is downloaded until the creator approves your list,
so check the moments from that text.

1. Plan the sub-types the idea covers (one per animal, decade, kind of fail…) and search once per sub-type, then by
   channel name for the channels known for the genre. Drop a sub-type after two searches of junk.
2. Look up your strongest candidates with video_details: the chapters and captions should show the moments the idea
   needs (for a before/after idea: the before, the care and the after).
3. Call propose_shortlist once: exactly the number of videos asked for, in the order the short plays them (#1 last for
   a ranking), plus up to ${MAX_RESEARCH_BACKUPS} backups that could take a spot. For each video: its id, its part in the
   short ("#3: the matted dog"), why in one sentence, and the moments you expect with rough times in seconds (a guess;
   null when you can't tell), each labelled "name: a few words" ("before: matted and scared"). Summarise how you searched in one line.

Never pick a live stream, a video over ${MAX_RESEARCH_VIDEO_SECONDS / 60} minutes, or the same video twice; prefer videos
under ${PREFERRED_RESEARCH_VIDEO_SECONDS / 60} minutes. You have ${RESEARCH_SEARCHES} searches and ${RESEARCH_LOOKUPS} lookups. If
YouTube refuses a request, stop and propose from what you already found; never try to get around it.`

// "Up to 60s", "Up to 3 min", "Any length", with the estimate for a ranking.
export const lengthLine = (research: Research) => {
  const ranking = `as a ranking ≈ ${clock(rankingSeconds(research.videos))} (about 15 s per entry, #1 about 25 s)`
  switch (research.length) {
    case "60":
      return `Up to 60 seconds: keep each video's moments short and clear (${research.videos} videos ${ranking}).`
    case "180":
      return `Up to 3 minutes, the Shorts limit (${research.videos} videos ${ranking}).`
    case "any":
      return `Any length (${research.videos} videos ${ranking}).`
  }
}

export interface ResearchInput {
  readonly research: Research
  readonly tools: ReadonlyArray<AgentTool>
  // replacing one spot of an approved list: the list and the spot's video, with why
  readonly replacing: { readonly previous: Shortlist; readonly videoId: string; readonly reason: string } | null
}

const describe = (list: Shortlist) =>
  list.picks.map((p, i) => `${i + 1}. ${p.videoId} · ${p.title} · ${p.channel ?? "?"} · ${p.durationS === null ? "?" : clock(p.durationS)} · ${p.part}`).join("\n")

// The research stage's agent task, shared by the stage and its tests.
export const researchTask = (input: ResearchInput): CheckedTask<typeof ProposedShortlist> => {
  const { research, replacing } = input
  const spot = replacing === null ? -1 : replacing.previous.picks.findIndex((p) => p.videoId === replacing.videoId)
  const brief = [
    `The idea: ${research.idea.trim()}`,
    `Videos: exactly ${replacing === null ? research.videos : replacing.previous.picks.length}, plus up to ${MAX_RESEARCH_BACKUPS} backups.`,
    `Length of the short: ${lengthLine(research)}`,
    looksLikeRanking(research.idea)
      ? "The idea reads as a ranking, so vet every pick by the skill's ranking rules: one subject, 1–6 minutes, over a million views as a strong hint, real interview lines in its captions (someone telling the story, not only music), and clear before and after footage. No compilations, music-only vlogs or re-uploads."
      : "",
    replacing === null
      ? ""
      : [
        `This is a replacement. The creator approved this list:\n${describe(replacing.previous)}`,
        `Find a new video for spot ${spot + 1} (${replacing.videoId}, "${replacing.previous.picks[spot]?.title ?? ""}"): ${replacing.reason}`,
        "Keep every other video exactly where it is, propose the whole list again, and don't bring the replaced video back."
      ].join("\n\n")
  ].filter((part) => part !== "").join("\n\n")
  return {
    stage: "research",
    instructions: RESEARCH_PROMPT,
    skills: ["finding-source-videos"],
    brief,
    output: {
      tool: "propose_shortlist",
      description: "Submit the shortlist: the picks in playing order, up to 3 backups, and how you searched.",
      schema: ProposedShortlist
    },
    defaultModel: "haiku",
    readDirs: [],
    tools: input.tools,
    // every search and lookup is a turn, plus the answer and a couple of fixes
    maxTurns: RESEARCH_SEARCHES + RESEARCH_LOOKUPS + 10
  }
}
