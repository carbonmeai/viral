import { ApproachName, SourceId, SourceSetId } from "@viral/contracts"
import { Console, Effect, Schema } from "effect"
import { flag, option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { follow } from "./run-command.ts"

export const SET_USAGE = `  set create <source-id>,<source-id>[,…] --brief "<why they belong together>" [--title <name>]
                                          (2–10 videos, in the order you'd tell it in)
  set run <id> [--again]                  (reads each video, then proposes shorts across them; --again proposes anew)
  set story <id> | list | rename <id> <name> | delete <id>
  set make <id> <n> [--brief "<another brief>"] [--as ranking|question-recap|claim-interleaved|cut-down]
                                          (a short from proposal n, with the set's brief; --as makes it another way:
                                          a ranking has an entry for every video in the set)`

const printSetStory = Effect.fn("printSetStory")(function*(id: SourceSetId) {
  const client = yield* Client
  const overview = yield* client.GetVideoSetOverview({ id })
  yield* Console.log(`${overview.set.title}\n  brief: ${overview.set.brief}`)
  for (const m of overview.members) {
    yield* Console.log(`  Video ${m.position + 1}  ${m.source.title ?? m.source.id}${m.ready ? "" : "  (not read yet)"}`)
  }
  const story = overview.story
  if (story === null) return yield* Console.log("no set story yet; run `set run`")
  yield* Console.log(`\n${story.summary}`)
  for (const b of story.beats) {
    yield* Console.log(`  Video ${b.source + 1}  ${b.start.toFixed(0)}–${b.end.toFixed(0)}s ${b.beat}: ${b.summary}`)
  }
  yield* Effect.forEach(story.proposals, (p, i) =>
    Console.log(`\n${i + 1}. ${p.title}  [${p.approach}]  uses ${p.sources.map((s) => `Video ${s + 1}`).join(", ")}\n   "${p.hook}"\n   ${p.why}`), { discard: true })
})

export const setCommand = Effect.fn("setCommand")(function*() {
  const client = yield* Client
  const [, sub = "list", id, value] = positionals
  switch (sub) {
    case "create": {
      const brief = option("--brief")
      if (id === undefined || brief === undefined) return yield* Console.error(SET_USAGE)
      const set = yield* client.CreateVideoSet({
        sourceIds: id.split(",").filter((s) => s !== "").map((s) => SourceId.make(s)),
        brief,
        title: option("--title") ?? null
      })
      return yield* Console.log(`${set.id}  ${set.title}`)
    }
    case "list":
      return yield* Effect.forEach(yield* client.ListVideoSets(), (s) => Console.log(`${s.id}  ${s.sourceIds.length} videos  ${s.title}`), { discard: true })
    case "run": {
      const setId = SourceSetId.make(id ?? "")
      const run = yield* client.StartSetRun({ setId, from: flag("--again") ? "set-story" : null })
      yield* follow(run.id)
      return yield* printSetStory(setId)
    }
    case "story":
      return yield* printSetStory(SourceSetId.make(id ?? ""))
    case "rename": {
      if (id === undefined || value === undefined) return yield* Console.error(SET_USAGE)
      const set = yield* client.RenameVideoSet({ id: SourceSetId.make(id), title: value })
      return yield* Console.log(`${set.id}  ${set.title}`)
    }
    case "make": {
      const n = Number(value)
      if (id === undefined || !Number.isInteger(n) || n < 1) return yield* Console.error(SET_USAGE)
      const as = option("--as")
      const approach = as === undefined ? undefined : yield* Schema.decodeUnknownEffect(ApproachName)(as)
      const project = yield* client.CreateProjectFromSetProposal({
        setId: SourceSetId.make(id),
        proposal: n - 1,
        brief: option("--brief") ?? null,
        ...(approach === undefined ? {} : { approach })
      })
      return yield* Console.log(`${project.id}  ${project.approach.padEnd(17)} ${project.slug}  (${project.sourceIds.length} videos)`)
    }
    case "delete":
      return yield* Console.log(`deleted: ${yield* client.DeleteVideoSet({ id: SourceSetId.make(id ?? "") })}`)
    default:
      return yield* Console.error(SET_USAGE)
  }
})
