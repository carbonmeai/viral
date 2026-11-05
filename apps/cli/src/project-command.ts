import { ApproachName, MusicTrackId, PresetId, Project, ProjectId, SourceId } from "@viral/contracts"
import { Console, Effect, Schema } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { show } from "./show.ts"

export const PROJECT_USAGE = `  project create <source-id> <title> [--approach question-recap|claim-interleaved|cut-down]
                 [--preset <id>] [--music <track-id>]
  project list [--source <id>] | show <id> | delete <id>`

const describe = (project: Project) => `${project.id}  ${project.approach.padEnd(17)} ${project.slug}`

const decodeApproach = Schema.decodeUnknownEffect(ApproachName)

const orNull = <A>(value: string | undefined, make: (value: string) => A) => value === undefined ? null : make(value)

export const projectCommand = Effect.fn("projectCommand")(function*() {
  const client = yield* Client
  const [, sub = "list", first, title] = positionals

  switch (sub) {
    case "create": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const project = yield* client.CreateProject({
        sourceId: SourceId.make(first),
        title,
        approach: yield* decodeApproach(option("--approach") ?? "question-recap"),
        presetId: orNull(option("--preset"), PresetId.make),
        musicTrackId: orNull(option("--music"), MusicTrackId.make)
      })
      return yield* Console.log(describe(project))
    }
    case "list": {
      const projects = yield* client.ListProjects({ sourceId: orNull(option("--source"), SourceId.make) })
      return yield* Effect.forEach(projects, (p) => Console.log(describe(p)), { discard: true })
    }
    case "show":
      return yield* show(Project)(yield* client.GetProject({ id: ProjectId.make(first ?? "") }))
    case "delete":
      return yield* Console.log(`deleted: ${yield* client.DeleteProject({ id: ProjectId.make(first ?? "") })}`)
    default:
      return yield* Console.error(PROJECT_USAGE)
  }
})
