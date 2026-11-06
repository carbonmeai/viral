import { ApproachName, MusicTrackId, PresetId, Project, ProjectId, SourceId, StageName } from "@viral/contracts"
import { Console, Effect, Schema } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { follow } from "./run-command.ts"
import { show } from "./show.ts"

export const PROJECT_USAGE = `  project create <source-id> <title> [--approach question-recap|claim-interleaved|cut-down]
                 [--preset <id>] [--music <track-id>]
  project from-proposal <source-id> <n>   (proposal n from \`source story\`)
  project style <id> <preset-id|default>  (the short's style; see \`preset list\`)
  project voice <id> <voice-id|preset>   (the voiceover's voice; "preset" goes back to the preset's)
  project run <id> [--from <stage>]
  project list [--source <id>] | show <id> | delete <id>`

const describe = (project: Project) => `${project.id}  ${project.approach.padEnd(17)} ${project.slug}`

const decodeApproach = Schema.decodeUnknownEffect(ApproachName)
const decodeStage = Schema.decodeUnknownEffect(StageName)

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
    case "from-proposal": {
      const n = Number(title)
      if (first === undefined || !Number.isInteger(n) || n < 1) return yield* Console.error(PROJECT_USAGE)
      const project = yield* client.CreateProjectFromProposal({ sourceId: SourceId.make(first), proposal: n - 1 })
      return yield* Console.log(describe(project))
    }
    case "style": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const project = yield* client.SetProjectPreset({
        id: ProjectId.make(first),
        presetId: title === "default" ? null : PresetId.make(title)
      })
      return yield* Console.log(`${describe(project)}  style ${project.presetId ?? "(default)"}`)
    }
    case "voice": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const project = yield* client.SetProjectVoice({ id: ProjectId.make(first), voiceId: title === "preset" ? null : title })
      return yield* Console.log(`${describe(project)}  voice ${project.voiceId ?? "(preset)"}`)
    }
    case "run": {
      const from = option("--from")
      const run = yield* client.StartProjectRun({
        projectId: ProjectId.make(first ?? ""),
        from: from === undefined ? null : yield* decodeStage(from)
      })
      return yield* follow(run.id)
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
