import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { positionals } from "./args.ts"
import { Client } from "./client.ts"
import { EVAL_USAGE, evalCommand } from "./eval-command.ts"
import { MUSIC_USAGE, musicCommand } from "./music-command.ts"
import { PRESET_USAGE, presetCommand } from "./preset-command.ts"
import { PROJECT_USAGE, projectCommand } from "./project-command.ts"
import { RUN_USAGE, runCommand } from "./run-command.ts"
import { SET_USAGE, setCommand } from "./set-command.ts"
import { SOURCE_USAGE, sourceCommand } from "./source-command.ts"
import { TOOLS_USAGE, toolsCommand } from "./tools-command.ts"
import { VOICE_USAGE, voiceCommand } from "./voice-command.ts"

// Dev client for the local Viral server (ws://127.0.0.1:3410/rpc).
const USAGE = ["usage: bun run cli <command>", SOURCE_USAGE, SET_USAGE, PROJECT_USAGE, PRESET_USAGE, MUSIC_USAGE, VOICE_USAGE, TOOLS_USAGE, RUN_USAGE, EVAL_USAGE].join("\n")

const program = Effect.gen(function*() {
  switch (positionals[0]) {
    case "source":
      return yield* sourceCommand()
    case "set":
      return yield* setCommand()
    case "project":
      return yield* projectCommand()
    case "preset":
      return yield* presetCommand()
    case "music":
      return yield* musicCommand()
    case "voices":
      return yield* voiceCommand()
    case "tools":
      return yield* toolsCommand()
    case "follow":
    case "cancel":
    case "resume":
    case "requests":
    case "approve":
    case "reject":
    case "edit":
      return yield* runCommand()
    default:
      return yield* Console.log(USAGE)
  }
}).pipe(
  // Domain errors print as one line instead of a stack trace.
  Effect.catchTags({
    SourceNotFound: (e) => Console.error(`no source ${e.id}`),
    SourceInUse: (e) => Console.error(`can't delete source ${e.id}: it's ${e.message}`),
    ProjectSourcesInvalid: (e) => Console.error(e.message),
    ProjectNotFound: (e) => Console.error(`no project ${e.id}`),
    VoiceError: (e) => Console.error(`ElevenLabs (${e.code}): ${e.message}`),
    VideoSetNotFound: (e) => Console.error(`no video set ${e.id}`),
    VideoSetInvalid: (e) => Console.error(e.message),
    VideoSetInUse: (e) => Console.error(`can't delete video set ${e.id}: it's ${e.message}`),
    SetProposalNotFound: (e) => Console.error(`video set ${e.setId} has no proposal ${e.proposal + 1}; see \`set story\``),
    ProposalNotFound: (e) => Console.error(`source ${e.sourceId} has no proposal ${e.proposal + 1}; see \`source story\``),
    PresetNotFound: (e) => Console.error(`no preset ${e.id}`),
    PresetIsDefault: (e) => Console.error(`preset ${e.id} is the default; make another one the default first`),
    MusicTrackNotFound: (e) => Console.error(`no music track ${e.id}`),
    MusicAnalysisError: (e) => Console.error(`couldn't analyse the track (${e.code}): ${e.message}`),
    MusicFileUnreadable: (e) => Console.error(`can't read ${e.file}: ${e.message}`),
    MusicArrangementInvalid: (e) => Console.error(`the arrangement can't be played:\n${e.problems.map((p) => `  - ${p}`).join("\n")}`),
    SchemaError: (e) => Console.error(e.message),
    RunNotFound: (e) => Console.error(`no run ${e.id}`),
    RequestNotPending: (e) => Console.error(`request ${e.id} isn't waiting for an answer`),
    NotPublished: (e) => Console.error(`short ${e.id} hasn't been published yet; run it to the end first`),
    PostTextInvalid: (e) => Console.error(`the post text can't be used:\n${e.problems.map((p) => `  - ${p}`).join("\n")}`),
    PublishUnavailable: (e) => Console.error(`can't publish: ${e.message}`)
  }),
  Effect.provide([Client.layer, NodeServices.layer])
)

// The eval starts its own server process and needs no connection to the running server.
NodeRuntime.runMain(positionals[0] === "eval" ? evalCommand().pipe(Effect.provide(NodeServices.layer)) : program)
