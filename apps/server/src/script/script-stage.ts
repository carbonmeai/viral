import { NodeServices } from "@effect/platform-node"
import { type Artifact, type GatePayload, type Project, type ProjectId, Script, StoryMap } from "@viral/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { Projects, sourcesOf } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { transcriptTools } from "../set-story/transcript-tools.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { loadShortStory } from "../video-sets/short-story.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { fitsInline } from "../projects/videos-brief.ts"
import { checkScript, fromProposedScript, narrationWords, SCRIPT_LIMITS } from "./script-rules.ts"
import { scriptTask } from "./script-task.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "script", code, message })

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the script stage runs on a project")
  return ctx.owner.id
}

// Writes a narrated short's script (narration plus real lines) with the project's approach skill, checks it
// against the approach and the transcript, and lets the agent fix what the server rejects. Gated: you approve,
// reject with a note, or edit it.
export class ScriptStage extends Context.Service<ScriptStage, {
  readonly stage: StageDefinition
}>()("@viral/server/script/script-stage/ScriptStage") {
  static readonly layer = Layer.effect(
    ScriptStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const projectSources = yield* ProjectSources
      const artifacts = yield* Artifacts
      const transcripts = yield* Transcripts
      const sets = yield* VideoSets
      const agent = yield* AgentSession

      // What the script is checked against: the approach's limits, and each video's transcript and ad ranges.
      const context = Effect.fn("ScriptStage.context")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const limits = SCRIPT_LIMITS[project.approach]
        if (limits === undefined) {
          return yield* fail("wrong-approach", `${project.approach} shorts don't have a narrated script`)
        }
        const sources = yield* projectSources.of(project).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        if (sources.some((s) => Option.isNone(s.transcript))) {
          const missing = sources.filter((s) => Option.isNone(s.transcript)).map((s) => `V${s.index + 1}`)
          return yield* fail("not-ready", sources.length === 1
            ? "the source has no transcript; run the source first"
            : `${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no transcript; read ${missing.length === 1 ? "it" : "them"} first`)
        }
        const [v1] = sources
        return { project, limits, sources, v1, transcript: Option.getOrThrow(v1.transcript) }
      })

      // V1's story proposal for this short's approach, if the video has a story map.
      const chosenAngle = Effect.fn("ScriptStage.chosenAngle")(function*(project: Project) {
        const story = yield* artifacts.latest({ _tag: "Source", id: sourcesOf(project)[0] }, "story-map")
        const map = Option.flatMap(story, (a) => Schema.decodeUnknownOption(StoryMap)(a.data))
        const proposal = Option.flatMapNullishOr(map, (m) => m.proposals.find((p) => p.approach === project.approach))
        return Option.match(proposal, { onNone: () => null, onSome: ({ title, hook, why }) => ({ title, hook, why }) })
      })

      const record = Effect.fn("ScriptStage.record")(function*(ctx: StageContext, script: Script) {
        const slot = yield* artifacts.allocate(ctx.owner, "script")
        yield* artifacts.record(slot, { data: script, path: null, stageRunId: ctx.stageRunId })
      })

      const run = Effect.fn("ScriptStage.run")(function*(ctx: StageContext) {
        const { project, limits, sources, v1, transcript } = yield* context(ctx)
        const source = v1.source
        const several = sources.length > 1
        // one video: its own story proposal; several: the set's proposal and beats, or each video's own beats
        const story = several ? yield* loadShortStory(project, artifacts, sets) : null
        const angle = story === null ? yield* chosenAngle(project) : story.angle
        const videos = sources.map((s) => ({
          title: s.source.title,
          channel: s.source.channel,
          seconds: s.seconds,
          transcript: Option.getOrNull(s.transcript),
          excluded: s.ads
        }))
        const task = scriptTask(project.approach, {
          creatorBrief: project.brief,
          title: source.title,
          channel: source.channel,
          transcript: transcripts.timedText(transcript),
          excluded: v1.excluded,
          angle,
          ...(several ? { videos, beats: story?.beats ?? [] } : {})
        })
        // long transcripts come as outlines, read further with the transcript tools
        const tools = several && !fitsInline(videos) ? transcriptTools(videos, "short") : []
        const script = yield* runChecked(agent, ctx, tools.length === 0 ? task : { ...task, tools, maxTurns: 24 }, (proposed) => Effect.sync(() => {
          const checked = checkScript(fromProposedScript(proposed), limits, sources)
          return { value: checked.script, problems: checked.problems }
        })).pipe(Effect.mapError((error) => fail(error.code, error.message)))
        yield* record(ctx, script)
      })

      const applyEdit = Effect.fn("ScriptStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const script = yield* Schema.decodeUnknownEffect(Script)(edited).pipe(Effect.mapError((e) => fail("invalid-edit", e.message)))
        const { limits, sources } = yield* context(ctx)
        const checked = checkScript(script, limits, sources)
        if (checked.problems.length > 0) return yield* fail("invalid-edit", checked.problems.join("; "))
        yield* record(ctx, checked.script)
      })

      const stage: StageDefinition = {
        name: "script",
        artifact: "script",
        gate: "Approve the script?",
        run,
        applyEdit,
        gatePayload: (artifact: Artifact): GatePayload =>
          Option.match(Schema.decodeUnknownOption(Script)(artifact.data), {
            onNone: () => ({ _tag: "ArtifactGate", artifact }),
            onSome: (script) => ({ _tag: "ScriptGate", script, narrationWords: narrationWords(script) })
          })
      }
      return ScriptStage.of({ stage })
    })
  ).pipe(Layer.provide([Projects.layer, ProjectSources.layer, Artifacts.layer, Transcripts.layer, VideoSets.layer, NodeServices.layer]))
}
