import {
  looksLikeRanking,
  ResearchLength,
  ResearchVideoCount,
  SourceSetId,
  videosForIdea
} from "@viral/contracts"
import { Console, Effect, Schema } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { follow } from "./run-command.ts"
import { describeShortlist } from "./shortlist-text.ts"

export const RESEARCH_USAGE = `  research start "<idea>" [--videos 3|5|7|10] [--length 60|180|any]   (videos: the idea's "Top N", else 5)
                                          (searches YouTube, downloads nothing; stops at the shortlist for approve / reject "<note>" / edit <file>)
  research show <set-id>                  (the shortlist again, with its request id while it waits)`

const decodeLength = Schema.decodeUnknownEffect(ResearchLength)
const decodeVideos = Schema.decodeUnknownEffect(ResearchVideoCount)

export const researchCommand = Effect.fn("researchCommand")(function*() {
  const client = yield* Client
  const [, sub, value] = positionals
  switch (sub) {
    case "start": {
      if (value === undefined || value.trim() === "") return yield* Console.error(RESEARCH_USAGE)
      const videos = yield* decodeVideos(option("--videos") === undefined ? videosForIdea(value) : Number(option("--videos")))
      const length = yield* decodeLength(option("--length") ?? (looksLikeRanking(value) ? "180" : "60"))
      const set = yield* client.StartResearch({ idea: value, videos, length })
      yield* Console.log(`video set ${set.id}  ${set.title}`)
      const runs = yield* client.ListRuns({ owner: { _tag: "Set", id: set.id } })
      if (runs[0] !== undefined) yield* follow(runs[0].id)
      return
    }
    case "show": {
      const id = SourceSetId.make(value ?? "")
      const overview = yield* client.GetVideoSetOverview({ id })
      if (overview.set.research === null) return yield* Console.error(`video set ${id} wasn't found from an idea`)
      const r = overview.set.research
      yield* Console.log(`${overview.set.title}\n  idea: ${r.idea} · ${r.videos} videos · ${r.length === "any" ? "any length" : `up to ${r.length}s`}`)
      if (overview.shortlist === null) return yield* Console.log("  still searching; no shortlist yet")
      yield* Console.log(describeShortlist(overview.shortlist))
      const pending = (yield* client.ListPendingRequests()).find((p) => overview.run !== null && p.runId === overview.run.id)
      return yield* Console.log(pending === undefined
        ? overview.members.length > 0 ? `  approved: ${overview.members.length} videos in the set (set story ${id})` : ""
        : `? ${pending.title}  →  approve ${pending.id}  |  reject ${pending.id} "note"  |  edit ${pending.id} <shortlist.json>`)
    }
    default:
      return yield* Console.error(RESEARCH_USAGE)
  }
})
