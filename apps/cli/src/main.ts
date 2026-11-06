import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { positionals } from "./args.ts"
import { Client } from "./client.ts"
import { MUSIC_USAGE, musicCommand } from "./music-command.ts"
import { PRESET_USAGE, presetCommand } from "./preset-command.ts"
import { PROJECT_USAGE, projectCommand } from "./project-command.ts"
import { RUN_USAGE, runCommand } from "./run-command.ts"
import { SOURCE_USAGE, sourceCommand } from "./source-command.ts"

// Dev client for the local Viral server (ws://127.0.0.1:3410/rpc).
const USAGE = ["usage: bun run cli <command>", SOURCE_USAGE, PROJECT_USAGE, PRESET_USAGE, MUSIC_USAGE, RUN_USAGE].join("\n")

const program = Effect.gen(function*() {
  switch (positionals[0]) {
    case "source":
      return yield* sourceCommand()
    case "project":
      return yield* projectCommand()
    case "preset":
      return yield* presetCommand()
    case "music":
      return yield* musicCommand()
    case "follow":
    case "cancel":
    case "resume":
    case "requests":
    case "approve":
    case "reject":
      return yield* runCommand()
    default:
      return yield* Console.log(USAGE)
  }
}).pipe(
  // Domain errors print as one line instead of a stack trace.
  Effect.catchTags({
    SourceNotFound: (e) => Console.error(`no source ${e.id}`),
    ProjectNotFound: (e) => Console.error(`no project ${e.id}`),
    ProposalNotFound: (e) => Console.error(`source ${e.sourceId} has no proposal ${e.proposal + 1}; see \`source story\``),
    PresetNotFound: (e) => Console.error(`no preset ${e.id}`),
    PresetIsDefault: (e) => Console.error(`preset ${e.id} is the default; make another one the default first`),
    MusicTrackNotFound: (e) => Console.error(`no music track ${e.id}`),
    MusicFileUnreadable: (e) => Console.error(`can't read ${e.file}: ${e.message}`),
    SchemaError: (e) => Console.error(e.message),
    RunNotFound: (e) => Console.error(`no run ${e.id}`),
    RequestNotPending: (e) => Console.error(`request ${e.id} isn't waiting for an answer`)
  }),
  Effect.provide([Client.layer, NodeServices.layer])
)

NodeRuntime.runMain(program)
