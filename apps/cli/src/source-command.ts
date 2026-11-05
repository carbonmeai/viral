import { Source, SourceId, SourceRights } from "@viral/contracts"
import { Console, Effect, Path, Schema } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { show } from "./show.ts"

export const SOURCE_USAGE = `  source add (--url <url> | --file <path>) [--rights owned|licensed] [--note <text>]
  source list | show <id> | delete <id>
  source rights <id> <unconfirmed|owned|licensed> [--note <text>]`

const describe = (source: Source) => {
  const origin = source.origin._tag === "Url" ? source.origin.url : source.origin.path
  return `${source.id}  ${source.rights.padEnd(11)} ${source.title ?? "(untitled)"}  <- ${origin}`
}

const decodeRights = Schema.decodeUnknownEffect(SourceRights)

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
        rightsNote: note
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
    case "delete":
      return yield* Console.log(`deleted: ${yield* client.DeleteSource({ id: SourceId.make(id ?? "") })}`)
    default:
      return yield* Console.error(SOURCE_USAGE)
  }
})
