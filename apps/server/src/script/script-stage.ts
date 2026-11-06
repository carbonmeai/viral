import { NodeServices } from "@effect/platform-node"
import { type Artifact, type GatePayload, type Project, type ProjectId, Script, StoryMap } from "@viral/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { type AdRange, checkScript, narrationWords, SCRIPT_LIMITS } from "./script-rules.ts"
import { scriptTask } from "./script-task.ts"

const AdRanges = Schema.Struct({ ranges: Schema.Array(Schema.Struct({ start: Schema.Finite, end: Schema.Finite })) })

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
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const transcripts = yield* Transcripts
      const agent = yield* AgentSession

      // What the script is checked against: the approach's limits, the transcript, and known ad ranges.
      const context = Effect.fn("ScriptStage.context")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const limits = SCRIPT_LIMITS[project.approach]
        if (limits === undefined) {
          return yield* fail("wrong-approach", `${project.approach} shorts don't have a narrated script`)
        }
        const transcript = yield* transcripts.forSource(project.sourceId).pipe(
          Effect.mapError(() => fail("not-ready", "the source has no transcript; run the source first"))
        )
        const adArtifact = yield* artifacts.latest({ _tag: "Source", id: project.sourceId }, "ad-ranges")
        const ads: ReadonlyArray<AdRange> = Option.match(adArtifact, {
          onNone: () => [],
          onSome: (a) => Option.getOrElse(Schema.decodeUnknownOption(AdRanges)(a.data), () => ({ ranges: [] })).ranges
        })
        const words = transcript.segments.flatMap((s) => s.words)
        return { project, limits, transcript, ads, words }
      })

      // The source story's proposal for this short's approach, if the source has a story map.
      const chosenAngle = Effect.fn("ScriptStage.chosenAngle")(function*(project: Project) {
        const story = yield* artifacts.latest({ _tag: "Source", id: project.sourceId }, "story-map")
        const map = Option.flatMap(story, (a) => Schema.decodeUnknownOption(StoryMap)(a.data))
        const proposal = Option.flatMapNullishOr(map, (m) => m.proposals.find((p) => p.approach === project.approach))
        return Option.match(proposal, { onNone: () => null, onSome: ({ title, hook, why }) => ({ title, hook, why }) })
      })

      const record = Effect.fn("ScriptStage.record")(function*(ctx: StageContext, script: Script) {
        const slot = yield* artifacts.allocate(ctx.owner, "script")
        yield* artifacts.record(slot, { data: script, path: null, stageRunId: ctx.stageRunId })
      })

      const run = Effect.fn("ScriptStage.run")(function*(ctx: StageContext) {
        const { project, limits, transcript, ads, words } = yield* context(ctx)
        const source = yield* sources.get(project.sourceId).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const angle = yield* chosenAngle(project)
        const script = yield* runChecked(agent, ctx, scriptTask(project.approach, {
          creatorBrief: project.brief,
          title: source.title,
          channel: source.channel,
          transcript: transcripts.timedText(transcript),
          excluded: ads,
          angle
        }), (proposed) => Effect.sync(() => {
          const checked = checkScript(proposed, limits, words, ads)
          return { value: checked.script, problems: checked.problems }
        })).pipe(Effect.mapError((error) => fail(error.code, error.message)))
        yield* record(ctx, script)
      })

      const applyEdit = Effect.fn("ScriptStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const script = yield* Schema.decodeUnknownEffect(Script)(edited).pipe(Effect.mapError((e) => fail("invalid-edit", e.message)))
        const { limits, ads, words } = yield* context(ctx)
        const checked = checkScript(script, limits, words, ads)
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
  ).pipe(Layer.provide([Projects.layer, Sources.layer, Artifacts.layer, Transcripts.layer, NodeServices.layer]))
}
