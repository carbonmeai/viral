import { RESEARCH_LOOKUPS, RESEARCH_SEARCH_RESULTS, RESEARCH_SEARCHES, youTubeId } from "@viral/contracts"
import { Effect, Schema } from "effect"
import { type AgentTool, agentTool } from "../agent-session/agent-session.ts"
import type { YouTube } from "./youtube.ts"
import { clock, type VideoDetails, type VideoFound, viewsLabel } from "./youtube-values.ts"

// What the research has learned so far: every video its searches and lookups returned (by YouTube id), the
// searches it ran, and whether YouTube refused it.
export interface ResearchCatalog {
  readonly videos: Map<string, VideoFound | VideoDetails>
  readonly searches: Array<string>
  // videos a lookup found removed, private or members-only, with what YouTube said
  readonly unavailable: Map<string, string>
  lookups: number
  blocked: string | null
}

export const emptyCatalog = (): ResearchCatalog => ({ videos: new Map(), searches: [], unavailable: new Map(), lookups: 0, blocked: null })

export const isDetails = (video: VideoFound | VideoDetails): video is VideoDetails => "description" in video

// A description goes to the agent up to this long.
const DESCRIPTION_CHARS = 1200

// "ksuKEz9YJvw | 3:05 | 760k views | The Dodo | This Rescue Dog's Transformation…" (a search result line)
export const resultLine = (v: VideoFound) =>
  [v.videoId, v.live === true ? "LIVE" : v.durationS === null ? "?:??" : clock(v.durationS), viewsLabel(v.views), v.channel ?? "unknown channel", v.title]
    .join(" | ")

export const detailsText = (v: VideoDetails) =>
  [
    `${v.title}`,
    `id ${v.videoId} · ${v.channel ?? "unknown channel"} · ${v.live === true ? "LIVE STREAM" : v.durationS === null ? "length unknown" : clock(v.durationS)} · ${viewsLabel(v.views)}${v.uploadDate === null ? "" : ` · uploaded ${v.uploadDate}`}`,
    "",
    `Description:\n${v.description.trim() === "" ? "(none)" : v.description.trim().slice(0, DESCRIPTION_CHARS)}${v.description.length > DESCRIPTION_CHARS ? "…" : ""}`,
    "",
    v.chapters.length === 0 ? "Chapters: none" : `Chapters:\n${v.chapters.map((c) => `[${clock(c.start)}] ${c.title}`).join("\n")}`,
    "",
    v.captions === null ? "Captions: none in English (judge from the title, description and chapters)" : `Captions (the start, times are rough):\n${v.captions}`
  ].join("\n")

const SearchInput = Schema.Struct({ query: Schema.String })
const DetailsInput = Schema.Struct({ video: Schema.String })

// The research agent's two tools over YouTube. `search_youtube` runs one search (8 results: title, channel, length,
// views); `video_details` reads one video's description, chapters and the start of its captions. Neither downloads
// anything. Each stops at its limit (20 searches, 20 lookups), and once YouTube refuses a request every later call
// says so instead of asking again: the agent then proposes from what it already found.
export const researchTools = (
  youtube: YouTube["Service"],
  catalog: ResearchCatalog,
  // tells whoever watches what the agent is doing ("searching YouTube: …")
  progress: (message: string) => Effect.Effect<void> = () => Effect.void
): ReadonlyArray<AgentTool> => {
  const refused = () =>
    `YouTube refused an earlier request (${catalog.blocked}). Don't try again: propose from the videos you already found.`
  const search = Effect.fn("search_youtube")(function*({ query }: typeof SearchInput.Type) {
    if (catalog.blocked !== null) return refused()
    const q = query.trim()
    if (q === "") return "give a search query"
    if (catalog.searches.length >= RESEARCH_SEARCHES) return `You've used all ${RESEARCH_SEARCHES} searches. Propose from the videos you found.`
    catalog.searches.push(q)
    yield* progress(`searching YouTube (${catalog.searches.length} of ${RESEARCH_SEARCHES}): ${q}`)
    const results = yield* youtube.search(q).pipe(Effect.result)
    if (results._tag === "Failure") {
      const error = results.failure
      if (error.kind === "blocked") catalog.blocked = error.message
      return error.kind === "blocked" ? refused() : `The search failed: ${error.message}`
    }
    for (const r of results.success) if (!catalog.videos.has(r.videoId)) catalog.videos.set(r.videoId, r)
    const left = RESEARCH_SEARCHES - catalog.searches.length
    return results.success.length === 0
      ? `No videos for "${q}". ${left} searches left.`
      : `${results.success.map(resultLine).join("\n")}\n(${left} searches left)`
  })

  const details = Effect.fn("video_details")(function*({ video }: typeof DetailsInput.Type) {
    if (catalog.blocked !== null) return refused()
    const id = youTubeId(video)
    if (id === null) return `"${video}" isn't a YouTube video id or link`
    const known = catalog.videos.get(id)
    if (known !== undefined && isDetails(known) && known.captions !== null) return detailsText(known)
    if (catalog.lookups >= RESEARCH_LOOKUPS) return `You've used all ${RESEARCH_LOOKUPS} lookups. Propose from what you know.`
    catalog.lookups++
    yield* progress(`reading the details of "${known?.title ?? id}"`)
    const looked = yield* youtube.details(id, { captions: true }).pipe(Effect.result)
    if (looked._tag === "Failure") {
      const error = looked.failure
      if (error.kind === "blocked") catalog.blocked = error.message
      if (error.kind === "unavailable") catalog.unavailable.set(id, error.message)
      return error.kind === "blocked" ? refused() : `Couldn't look up ${id}: ${error.message}. Don't pick it.`
    }
    catalog.videos.set(id, looked.success)
    return `${detailsText(looked.success)}\n(${RESEARCH_LOOKUPS - catalog.lookups} lookups left)`
  })

  return [
    agentTool({
      name: "search_youtube",
      description:
        `Search YouTube once: returns ${RESEARCH_SEARCH_RESULTS} results as "id | length | views | channel | title". One request each; at most ${RESEARCH_SEARCHES} searches per research, so make each one count.`,
      schema: SearchInput,
      run: search
    }),
    agentTool({
      name: "video_details",
      description:
        `Read one video's details without downloading it: length, views, upload date, the description, the chapter list and the start of its English captions with rough times. Pass its id (or link). At most ${RESEARCH_LOOKUPS} per research: use it on your strongest candidates to check they really have the moments.`,
      schema: DetailsInput,
      run: details
    })
  ]
}
