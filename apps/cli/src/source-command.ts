import { type Artifact, Source, SourceId, SourceRights, StoryMap } from "@viral/contracts"
import { Console, Effect, Option, Path, Schema } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { follow } from "./run-command.ts"
import { show } from "./show.ts"

export const SOURCE_USAGE = `  source add (--url <url> | --file <path>) [--rights owned|licensed] [--note <text>] [--name <short name>]
  source list | show <id> | delete <id>
  source rights <id> <unconfirmed|owned|licensed> [--note <text>]
  source details <id> [--title <title>] [--channel <channel>]   (name a local video; the channel is credited)
  source rename <id> <short name|auto>   (the name its lanes and badges show; auto = made from the title)
  source run <id>                (source → transcribe → contact sheets → ads → story; reuses finished work)
  source story <id>              (the story's proposals; make one with \`project from-proposal\`)
  source artifacts <id>`

const describe = (source: Source) => {
  const origin = source.origin._tag === "Url" ? source.origin.url : source.origin.path
  return `${source.id}  ${source.rights.padEnd(11)} ${source.title ?? "(untitled)"}${source.shortName === null ? "" : ` "${source.shortName}"`}  <- ${origin}`
}

const decodeRights = Schema.decodeUnknownEffect(SourceRights)

const describeArtifact = (artifact: Artifact) => `${artifact.kind.padEnd(14)} v${artifact.version}  ${artifact.path ?? ""}`

// The story map's proposals, numbered for `project from-proposal <source> <n>`.
const printStory = Effect.fn("printStory")(function*(sourceId: SourceId) {
  const client = yield* Client
  const artifacts = yield* client.ListArtifacts({ owner: { _tag: "Source", id: sourceId } })
  const story = Option.fromNullishOr(artifacts.findLast((a) => a.kind === "story-map")).pipe(
    Option.flatMap((a) => Schema.decodeUnknownOption(StoryMap)(a.data))
  )
  if (Option.isNone(story)) return yield* Console.log("no story yet; run the source first")
  yield* Console.log(`\n${story.value.summary}\n`)
  yield* Effect.forEach(story.value.proposals, (p, i) => {
    const { openLoop, completionCompulsion, universalRelatability, shareability } = p.scores
    return Console.log([
      `${i + 1}. ${p.title}  [${p.approach}]`,
      `   hook: ${p.hook}`,
      `   why:  ${p.why}`,
      `   open loop ${openLoop} · completion ${completionCompulsion} · relatable ${universalRelatability} · share ${shareability}`
    ].join("\n"))
  }, { discard: true })
  yield* Console.log(`\nmake one: viral project from-proposal ${sourceId} <n>`)
})

export const sourceCommand = Effect.fn("sourceCommand")(function*() {
  const client = yield* Client
  const path = yield* Path.Path
  const [, sub = "list", id, value] = positionals
  const note = option("--note") ?? null

  switch (sub) {
    case "add": {
      const url = option("--url")
      const file = option("--file")
      if ((url === undefined) === (file === undefined)) return yield* Console.error(SOURCE_USAGE)
      const source = yield* client.CreateSource({
        origin: url !== undefined ? { _tag: "Url", url } : { _tag: "File", path: path.resolve(file ?? "") },
        rights: yield* decodeRights(option("--rights") ?? "unconfirmed"),
        rightsNote: note,
        shortName: option("--name") ?? null
      })
      return yield* Console.log(describe(source))
    }
    case "list":
      return yield* Effect.forEach(yield* client.ListSources(), (s) => Console.log(describe(s)), { discard: true })
    case "show":
      return yield* show(Source)(yield* client.GetSource({ id: SourceId.make(id ?? "") }))
    case "rights": {
      const source = yield* client.SetSourceRights({
        id: SourceId.make(id ?? ""),
        rights: yield* decodeRights(value),
        rightsNote: note
      })
      return yield* Console.log(describe(source))
    }
    case "details": {
      const current = yield* client.GetSource({ id: SourceId.make(id ?? "") })
      const source = yield* client.SetSourceDetails({
        id: current.id,
        title: option("--title") ?? current.title,
        channel: option("--channel") ?? current.channel
      })
      return yield* Console.log(`${describe(source)}${source.channel === null ? "" : `  (by ${source.channel})`}`)
    }
    case "rename": {
      const name = positionals.slice(3).join(" ")
      if (id === undefined || name === "") return yield* Console.error(SOURCE_USAGE)
      const source = yield* client.RenameVideo({ id: SourceId.make(id), shortName: name === "auto" ? null : name })
      return yield* Console.log(describe(source))
    }
    case "run": {
      const sourceId = SourceId.make(id ?? "")
      const run = yield* client.StartSourceRun({ sourceId })
      yield* follow(run.id)
      return yield* printStory(sourceId)
    }
    case "story":
      return yield* printStory(SourceId.make(id ?? ""))
    case "artifacts": {
      const artifacts = yield* client.ListArtifacts({ owner: { _tag: "Source", id: SourceId.make(id ?? "") } })
      return yield* Effect.forEach(artifacts, (a) => Console.log(describeArtifact(a)), { discard: true })
    }
    case "delete":
      return yield* Console.log(`deleted: ${yield* client.DeleteSource({ id: SourceId.make(id ?? "") })}`)
    default:
      return yield* Console.error(SOURCE_USAGE)
  }
})
