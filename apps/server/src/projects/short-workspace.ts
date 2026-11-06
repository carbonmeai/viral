import { NodeServices } from "@effect/platform-node"
import {
  type ArtifactKind,
  CutPlan,
  type ProjectId,
  type ProjectNotFound,
  PublishedShort,
  RenderedShort,
  Script,
  ShotPlan,
  type ShortWorkspace,
  Transcript,
  Voiceover
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Presets } from "../presets/presets.ts"
import { RunStore } from "../runs/run-store.ts"
import { SCRIPT_LIMITS } from "../script/script-rules.ts"
import { Sources } from "../sources/sources.ts"
import { Projects } from "./projects.ts"

const TranscriptJson = Schema.fromJsonString(Transcript)

// A short's editor in one call: the short, its video, style and voice, its latest run with the gate it's waiting
// on, and the latest version of everything the run has made (an artifact that no longer decodes is left out, so
// an old version never breaks the editor).
export class ShortWorkspaces extends Context.Service<ShortWorkspaces, {
  get(projectId: ProjectId): Effect.Effect<ShortWorkspace, ProjectNotFound>
}>()("@viral/server/projects/short-workspace/ShortWorkspaces") {
  static readonly layer = Layer.effect(
    ShortWorkspaces,
    Effect.gen(function*() {
      const projects = yield* Projects
      const sources = yield* Sources
      const presets = yield* Presets
      const artifacts = yield* Artifacts
      const store = yield* RunStore
      const fs = yield* FileSystem.FileSystem

      const get = Effect.fn("ShortWorkspaces.get")(function*(projectId: ProjectId) {
        const project = yield* projects.get(projectId)
        const owner = { _tag: "Project", id: projectId } as const
        const source = yield* sources.get(project.sourceId).pipe(Effect.orDie)
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.catch(() => presets.getDefault))
        const limits = SCRIPT_LIMITS[project.approach]

        const runs = yield* store.listRuns(owner)
        const run = [...runs].sort((a, b) => b.startedAt.epochMilliseconds - a.startedAt.epochMilliseconds)[0] ?? null
        const stages = run === null ? [] : yield* store.listStageRuns(run.id)
        const pending = run === null ? null : (yield* store.listPendingRequests).find((r) => r.runId === run.id) ?? null

        // the latest version of a kind, decoded; none when it's missing or no longer decodes
        const latest = <A, I>(kind: ArtifactKind, schema: Schema.Codec<A, I>) =>
          Effect.map(artifacts.latest(owner, kind), (artifact) =>
            Option.flatMap(artifact, (a) =>
              Option.map(Schema.decodeUnknownOption(schema)(a.data), (data) => ({ version: a.version, path: a.path, data }))))

        const script = yield* latest("script", Script)
        const voiceover = yield* latest("voiceover", Voiceover)
        const voTranscript = yield* artifacts.latest(owner, "voiceover-transcript")
        const words = yield* Option.match(Option.flatMapNullishOr(voTranscript, artifacts.resolve), {
          onNone: () => Effect.succeed([]),
          onSome: (file) =>
            fs.readFileString(file).pipe(
              Effect.flatMap(Schema.decodeEffect(TranscriptJson)),
              Effect.map((t) => t.segments.flatMap((s) => s.words)),
              Effect.orElseSucceed(() => [])
            )
        })
        const shotPlan = yield* latest("shot-plan", ShotPlan)
        const cutPlan = yield* latest("cut-plan", CutPlan)
        const render = yield* latest("render", RenderedShort)
        const metadata = yield* latest("metadata", PublishedShort)
        const sourceVideo = yield* artifacts.latest({ _tag: "Source", id: project.sourceId }, "source-video")

        return {
          project,
          source,
          preset,
          voiceId: project.voiceId ?? preset.config.voice.voiceId,
          scriptLimits: limits === undefined
            ? null
            : { narrationWords: [...limits.narrationWords], reals: [...limits.reals], realsOnlyAtEnd: limits.realsOnlyAtEnd },
          run,
          stages,
          pending,
          script: Option.getOrNull(Option.map(script, (a) => ({ version: a.version, path: a.path, script: a.data }))),
          voiceover: Option.getOrNull(Option.map(voiceover, (a) => ({ version: a.version, path: a.path, voiceover: a.data, words }))),
          shotPlan: Option.getOrNull(Option.map(shotPlan, (a) => ({ version: a.version, path: a.path, plan: a.data }))),
          cutPlan: Option.getOrNull(Option.map(cutPlan, (a) => ({ version: a.version, path: a.path, plan: a.data }))),
          render: Option.getOrNull(Option.map(render, (a) => ({ version: a.version, path: a.path, render: a.data }))),
          metadata: Option.getOrNull(Option.map(metadata, (a) => ({ version: a.version, path: a.path, metadata: a.data }))),
          sourceVideo: Option.getOrNull(Option.flatMapNullishOr(sourceVideo, (a) => a.path))
        } satisfies ShortWorkspace
      })

      return ShortWorkspaces.of({ get })
    })
  ).pipe(Layer.provide([Projects.layer, Sources.layer, Presets.layer, Artifacts.layer, RunStore.layer, NodeServices.layer]))
}
