import {
  ApproachName,
  MusicArrangement,
  MusicTrackId,
  PresetId,
  Project,
  ProjectId,
  type PublishStatus,
  SourceId,
  StageName
} from "@viral/contracts"
import { Console, Effect, FileSystem, Path, Schema } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { follow } from "./run-command.ts"
import { show } from "./show.ts"

export const PROJECT_USAGE = `  project create <source-id>[,<source-id>…] <title> [--approach question-recap|claim-interleaved|story-recap|cut-down|ranking|narrated-ranking]
                 [--preset <id>] [--music <track-id>] [--brief "<what it should achieve>"]
                                          (several videos in order, need a brief)
  project from-proposal <source-id> <n> [--as <approach>]
                                          (proposal n from \`source story\`; --as makes it another way, e.g. story-recap)
  project rename <id> "<title>"           (the short's title; its folder and files keep their names)
  project style <id> <preset-id|default>  (the short's style; see \`preset list\`)
  project music <id> <track-id|none>      (none = voice only)
  project music-arrange <id> <file.json|auto>
                                          (the music's arrangement: {"blocks": [{"fromBar", "toBar", "loops",
                                          "start": "after" | "drop" | {"word": n}}]}; auto = the automatic one;
                                          re-runs from assemble)
  project voice <id> <voice-id|preset>   (the voiceover's voice; "preset" goes back to the preset's)
  project add-video <id> <source-id>      (adds a video after the short's others, up to 10; nothing re-runs:
                                          \`project run <id> --from script|sections\` reads it and uses it)
  project remove-video <id> <source-id>   (refused while a step's current work uses it)
  project run <id> [--from <stage>]
  project post <id>                       (the post text and what publishing again would update)
  project publish <id> [--title "<title>"|--title agent]
                                          (rewrites the short's files in ~/.viral/renders/: your title, the credit
                                          as it is now; re-renders first, no agents, when the credit is drawn on
                                          the video)
  project list [--source <id>] | show <id> | delete <id>`

const describe = (project: Project) => `${project.id}  ${project.approach.padEnd(17)} ${project.slug}`

const decodeApproach = Schema.decodeUnknownEffect(ApproachName)
const decodeStage = Schema.decodeUnknownEffect(StageName)
const decodeArrangement = Schema.decodeEffect(Schema.fromJsonString(MusicArrangement))

const CHANGES: Record<PublishStatus["changes"][number], string> = {
  title: "the title",
  description: "the description",
  hashtags: "the hashtags",
  credit: "the credit",
  video: "the video",
  missing: "missing files"
}

const printPost = (status: PublishStatus) =>
  Console.log([
    `title        ${status.post.title}${status.edited ? "  (yours)" : ""}`,
    `description  ${status.post.description}`,
    `hashtags     ${status.post.hashtags.join(" ")}`,
    `credit       ${status.credit ?? "(none)"}`,
    status.changes.length === 0
      ? "published    up to date"
      : `publish again updates ${status.changes.map((c) => CHANGES[c]).join(", ")}${status.rerender ? " (re-renders the video first)" : ""}`
  ].join("\n"))

const orNull = <A>(value: string | undefined, make: (value: string) => A) => value === undefined ? null : make(value)

export const projectCommand = Effect.fn("projectCommand")(function*() {
  const client = yield* Client
  const [, sub = "list", first, title] = positionals

  switch (sub) {
    case "create": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const [v1 = "", ...others] = first.split(",").filter((id) => id !== "")
      const project = yield* client.CreateProject({
        sourceIds: [SourceId.make(v1), ...others.map((id) => SourceId.make(id))],
        title,
        brief: option("--brief") ?? null,
        approach: yield* decodeApproach(option("--approach") ?? "question-recap"),
        presetId: orNull(option("--preset"), PresetId.make),
        musicTrackId: orNull(option("--music"), MusicTrackId.make)
      })
      return yield* Console.log(describe(project))
    }
    case "from-proposal": {
      const n = Number(title)
      if (first === undefined || !Number.isInteger(n) || n < 1) return yield* Console.error(PROJECT_USAGE)
      const as = option("--as")
      const project = yield* client.CreateProjectFromProposal({
        sourceId: SourceId.make(first),
        proposal: n - 1,
        ...(as === undefined ? {} : { approach: yield* decodeApproach(as) })
      })
      return yield* Console.log(describe(project))
    }
    case "rename": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const project = yield* client.RenameProject({ id: ProjectId.make(first), title })
      return yield* Console.log(`${describe(project)}  ${project.title}`)
    }
    case "style": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const project = yield* client.SetProjectPreset({
        id: ProjectId.make(first),
        presetId: title === "default" ? null : PresetId.make(title)
      })
      return yield* Console.log(`${describe(project)}  style ${project.presetId ?? "(default)"}`)
    }
    case "music": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const project = yield* client.SetProjectMusic({
        id: ProjectId.make(first),
        musicTrackId: title === "none" ? null : MusicTrackId.make(title)
      })
      return yield* Console.log(`${describe(project)}  music ${project.musicTrackId ?? "(none)"}`)
    }
    case "music-arrange": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const arrangement = title === "auto" ? null : yield* fs.readFileString(path.resolve(title)).pipe(Effect.flatMap(decodeArrangement))
      const run = yield* client.ArrangeMusic({ projectId: ProjectId.make(first), arrangement })
      return yield* follow(run.id)
    }
    case "voice": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const project = yield* client.SetProjectVoice({ id: ProjectId.make(first), voiceId: title === "preset" ? null : title })
      return yield* Console.log(`${describe(project)}  voice ${project.voiceId ?? "(preset)"}`)
    }
    case "add-video":
    case "remove-video": {
      if (first === undefined || title === undefined) return yield* Console.error(PROJECT_USAGE)
      const input = { id: ProjectId.make(first), sourceId: SourceId.make(title) }
      const project = yield* (sub === "add-video" ? client.AddSourceToProject(input) : client.RemoveSourceFromProject(input))
      yield* Console.log(`${describe(project)}  ${project.sourceIds.length} ${project.sourceIds.length === 1 ? "video" : "videos"}`)
      return yield* Effect.forEach(project.sourceIds, (id, i) => Console.log(`  V${i + 1}  ${id}`), { discard: true })
    }
    case "run": {
      const from = option("--from")
      const run = yield* client.StartProjectRun({
        projectId: ProjectId.make(first ?? ""),
        from: from === undefined ? null : yield* decodeStage(from)
      })
      return yield* follow(run.id)
    }
    case "post":
      return yield* printPost(yield* client.GetPublishStatus({ projectId: ProjectId.make(first ?? "") }))
    case "publish": {
      if (first === undefined) return yield* Console.error(PROJECT_USAGE)
      const projectId = ProjectId.make(first)
      const title = option("--title")
      if (title !== undefined) {
        const { post } = yield* client.GetPublishStatus({ projectId })
        yield* client.SetPostText({ projectId, post: title === "agent" ? null : { ...post, title } })
      }
      const result = yield* client.PublishAgain({ projectId })
      if (result._tag === "Published") return yield* printPost(result.status)
      yield* Console.log("the credit is drawn on the video: re-rendering it; approve the render and the files are replaced")
      return yield* follow(result.run.id)
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
